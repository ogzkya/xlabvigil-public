package backupcrypto

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"filippo.io/age"
)

const testPassphrase = "Yalnız-bu-test-için-uzun-parola-🔒"

func privateDir(t *testing.T) string {
	t.Helper()
	path := t.TempDir()
	makePrivate(t, path)
	return path
}

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func source(t *testing.T, dump []byte) string {
	t.Helper()
	path := privateDir(t)
	write(t, filepath.Join(path, "metadata.json"), []byte(`{"product":"XLab Vigil","formatVersion":1}`))
	write(t, filepath.Join(path, "database.dump"), dump)
	return path
}

func requireEmpty(t *testing.T, path string) {
	t.Helper()
	entries, err := os.ReadDir(path)
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed decrypt retained output entries: %v, %v", entries, err)
	}
}

func TestReadPassphraseBoundariesAndNoSecondLine(t *testing.T) {
	for _, input := range []string{strings.Repeat("a", 12), strings.Repeat("a", 1024), testPassphrase + "\n", testPassphrase + "\r\n", strings.Repeat("🔒", 256)} {
		password, err := ReadPassphrase(strings.NewReader(input))
		if err != nil || !validPassphrase(password) {
			t.Fatal("valid UTF-8 stdin password rejected")
		}
	}
	for _, input := range []string{"", strings.Repeat("a", 11), strings.Repeat("a", 1025), strings.Repeat("🔒", 257), testPassphrase + "\nextra", testPassphrase + "\n\n", "invalid\rpassphrase", "invalid\x00passphrase", testPassphrase + "\r", testPassphrase + string([]byte{0xff})} {
		if _, err := ReadPassphrase(strings.NewReader(input)); !errors.Is(err, ErrPassphrase) {
			t.Fatal("invalid stdin password accepted")
		}
	}
}

func TestProductionAgeRoundtripUnicodeAndMultipleChunks(t *testing.T) {
	dump := bytes.Repeat([]byte("PGDMP-test-data-🔒\x00"), 15000)
	input := source(t, dump)
	path := filepath.Join(t.TempDir(), "backup.age")
	if err := Encrypt(input, path, testPassphrase); err != nil {
		t.Fatal(err)
	}
	encrypted, err := os.ReadFile(path)
	if err != nil || !bytes.HasPrefix(encrypted, []byte("age-encryption.org/v1\n")) || bytes.Contains(encrypted, []byte(testPassphrase)) || bytes.Contains(encrypted, []byte(`{"product":"XLab Vigil"`)) {
		t.Fatal("output is not a standard, opaque age file")
	}
	output := privateDir(t)
	if err := Decrypt(path, output, testPassphrase); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"metadata.json", "database.dump"} {
		before, err := os.ReadFile(filepath.Join(input, name))
		if err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(filepath.Join(output, name))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("roundtrip changed %s", name)
		}
	}
	// The maintained age library can also directly decrypt the portable tar.
	identity, _ := age.NewScryptIdentity(testPassphrase)
	identity.SetMaxWorkFactor(WorkFactor)
	plaintext, err := age.Decrypt(bytes.NewReader(encrypted), identity)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(io.Discard, plaintext); err != nil {
		t.Fatal("standard age did not authenticate the complete output")
	}
}

func ageFile(t *testing.T, payload []byte) string {
	t.Helper()
	var output bytes.Buffer
	recipient, _ := age.NewScryptRecipient(testPassphrase)
	recipient.SetWorkFactor(4) // Mutation tests do not repeat expensive KDF work.
	encrypted, err := age.Encrypt(&output, recipient)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := encrypted.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := encrypted.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "backup.age")
	write(t, path, output.Bytes())
	return path
}

type entry struct {
	name     string
	typeflag byte
	data     []byte
	size     int64
	link     string
	pax      map[string]string
}

func tarBytes(t *testing.T, entries []entry) []byte {
	t.Helper()
	var payload bytes.Buffer
	writer := tar.NewWriter(&payload)
	for _, item := range entries {
		if item.typeflag == 0 {
			item.typeflag = tar.TypeReg
		}
		size := int64(len(item.data))
		if item.size != 0 {
			size = item.size
		}
		format := tar.FormatUSTAR
		if item.pax != nil || size >= 8<<30 {
			format = tar.FormatPAX
		}
		if err := writer.WriteHeader(&tar.Header{Name: item.name, Mode: 0600, Size: size, Typeflag: item.typeflag, Linkname: item.link, Format: format, PAXRecords: item.pax}); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(item.data); err != nil {
			t.Fatal(err)
		}
		if size != int64(len(item.data)) {
			return payload.Bytes() // Invalid declared sizes must fail before extraction.
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return payload.Bytes()
}

func normalEntries() []entry {
	return []entry{{name: "metadata.json", data: []byte(`{"product":"XLab Vigil"}`)}, {name: "database.dump", data: []byte("PGDMP-valid-test-data")}}
}

func TestCiphertextWrongPasswordTamperTruncationAndAppend(t *testing.T) {
	path := ageFile(t, tarBytes(t, normalEntries()))
	data, _ := os.ReadFile(path)
	for _, kind := range []string{"wrong_password", "header", "payload", "truncated", "appended", "concatenated"} {
		t.Run(kind, func(t *testing.T) {
			mutation := append([]byte(nil), data...)
			password := testPassphrase
			switch kind {
			case "wrong_password":
				password = "different-long-test-password"
			case "header":
				mutation[0] ^= 1
			case "payload":
				mutation[len(mutation)-20] ^= 1
			case "truncated":
				mutation = mutation[:len(mutation)-1]
			case "appended":
				mutation = append(mutation, 1)
			case "concatenated":
				mutation = append(mutation, data...)
			}
			input := filepath.Join(t.TempDir(), "mutated.age")
			write(t, input, mutation)
			output := privateDir(t)
			if err := Decrypt(input, output, password); !errors.Is(err, ErrArchive) {
				t.Fatalf("corrupted input accepted: %v", err)
			}
			requireEmpty(t, output)
		})
	}
}

func TestRejectUnsafeTarEntriesAndCleanupPartialOutput(t *testing.T) {
	for _, kind := range []string{"traversal", "absolute", "backslash", "symlink", "hardlink", "directory", "duplicate", "extra", "missing", "metadata_limit", "dump_limit", "pax_metadata", "records_after_eof"} {
		t.Run(kind, func(t *testing.T) {
			entries := normalEntries()
			switch kind {
			case "traversal":
				entries[1].name = "../database.dump"
			case "absolute":
				entries[1].name = "/database.dump"
			case "backslash":
				entries[1].name = `..\database.dump`
			case "symlink":
				entries[1] = entry{name: "database.dump", typeflag: tar.TypeSymlink, link: "metadata.json"}
			case "hardlink":
				entries[1] = entry{name: "database.dump", typeflag: tar.TypeLink, link: "metadata.json"}
			case "directory":
				entries[1] = entry{name: "database.dump", typeflag: tar.TypeDir}
			case "duplicate":
				entries[1] = entries[0]
			case "extra":
				entries = append(entries, entry{name: "extra.txt", data: []byte("other")})
			case "missing":
				entries = entries[:1]
			case "metadata_limit":
				entries[0].data = bytes.Repeat([]byte("a"), MaxMetadataBytes+1)
			case "dump_limit":
				entries[1].size = MaxDumpBytes + 1
			case "pax_metadata":
				entries[0].pax = map[string]string{"comment": "additional metadata"}
			}
			payload := tarBytes(t, entries)
			if kind == "records_after_eof" {
				payload = append(payload, tarBytes(t, normalEntries())...)
			}
			output := privateDir(t)
			if err := Decrypt(ageFile(t, payload), output, testPassphrase); !errors.Is(err, ErrArchive) {
				t.Fatalf("unsafe archive accepted: %v", err)
			}
			requireEmpty(t, output)
		})
	}
}

func TestTarEOFStillAuthenticatesFinalAgeChunk(t *testing.T) {
	payload := append(tarBytes(t, normalEntries()), make([]byte, 128<<10)...)
	path := ageFile(t, payload)
	output := privateDir(t)
	if err := Decrypt(path, output, testPassphrase); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	data[len(data)-1] ^= 1 // This chunk is beyond tar EOF, not in either file.
	write(t, path, data)
	output = privateDir(t)
	if err := Decrypt(path, output, testPassphrase); !errors.Is(err, ErrArchive) {
		t.Fatalf("final age authentication was skipped: %v", err)
	}
	requireEmpty(t, output)
}

func TestExistingTargetsAndExtraSourceFilesArePreserved(t *testing.T) {
	input := source(t, []byte("PGDMP-valid"))
	path := filepath.Join(t.TempDir(), "existing.age")
	write(t, path, []byte("existing file"))
	if err := encrypt(input, path, testPassphrase, 4); !errors.Is(err, ErrOutput) {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "existing file" {
		t.Fatal("existing encrypted target changed")
	}
	output := privateDir(t)
	write(t, filepath.Join(output, "existing.txt"), []byte("keep"))
	if err := Decrypt(ageFile(t, tarBytes(t, normalEntries())), output, testPassphrase); !errors.Is(err, ErrOutput) {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(filepath.Join(output, "existing.txt"))
	if string(data) != "keep" {
		t.Fatal("existing decrypted directory contents changed")
	}
	write(t, filepath.Join(input, "secret.txt"), []byte("must not be packaged"))
	newPath := filepath.Join(t.TempDir(), "new.age")
	if err := encrypt(input, newPath, testPassphrase, 4); !errors.Is(err, ErrSource) {
		t.Fatal(err)
	}
	if _, err := os.Stat(newPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("invalid source created output")
	}
}

func TestEncryptSourceChangeRemovesOnlyItsNewOutput(t *testing.T) {
	input := source(t, bytes.Repeat([]byte("x"), 256<<10))
	output := filepath.Join(t.TempDir(), "partial.age")
	done := make(chan error, 1)
	go func() { done <- Encrypt(input, output, testPassphrase) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(output); err == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("encryption finished before source mutation: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("encryption did not create its output")
		}
		time.Sleep(time.Millisecond)
	}
	if err := os.Truncate(filepath.Join(input, "database.dump"), 1); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, ErrSource) {
		t.Fatalf("source mutation accepted: %v", err)
	}
	if _, err := os.Stat(output); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("encryption failure retained partial output")
	}
}

func TestCleanupDoesNotDeleteReplacementFile(t *testing.T) {
	path := privateDir(t)
	root, err := os.OpenRoot(path)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	file, created, err := createFile(root, "metadata.json")
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if err := root.Rename("metadata.json", "original.json"); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(path, "metadata.json"), []byte("replacement"))
	removeCreated(root, []createdFile{created})
	data, err := os.ReadFile(filepath.Join(path, "metadata.json"))
	if err != nil || string(data) != "replacement" {
		t.Fatal("cleanup deleted another file's identity")
	}
}

func TestScryptWorkFactorAboveLimitIsRejectedBeforeKDF(t *testing.T) {
	input := ageFile(t, tarBytes(t, normalEntries()))
	data, _ := os.ReadFile(input)
	// Recipient header is authenticated; this mutation must be rejected without
	// attempting a prohibitively expensive attacker-selected scrypt computation.
	lines := bytes.Split(data, []byte("\n"))
	for index, line := range lines {
		if bytes.HasPrefix(line, []byte("-> scrypt ")) {
			parts := bytes.Split(line, []byte(" "))
			parts[len(parts)-1] = []byte("30")
			lines[index] = bytes.Join(parts, []byte(" "))
			break
		}
	}
	write(t, input, bytes.Join(lines, []byte("\n")))
	output := privateDir(t)
	if err := Decrypt(input, output, testPassphrase); !errors.Is(err, ErrArchive) {
		t.Fatal(err)
	}
	requireEmpty(t, output)
}
