// Package backupcrypto stores the two-file Vigil backup as a standard age file
// containing a tar stream. Encryption and authentication are provided by age.
package backupcrypto

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"filippo.io/age"
)

const (
	MaxMetadataBytes = 64 << 10
	MaxDumpBytes     = 1 << 40 // Local safety ceiling, streamed without buffering.
	WorkFactor       = 18      // age's maintained default; also our decrypt limit.
	maxTarPadding    = 1 << 20
	maxEncryptedSize = MaxDumpBytes + MaxDumpBytes/(64<<10)*16 + MaxMetadataBytes + 2<<20
)

var (
	ErrPassphrase = errors.New("Parola geçerli UTF-8, tek satır ve 12–1024 bayt olmalı.")
	ErrSource     = errors.New("Yedek kaynağı veya dosya sınırları geçersiz.")
	ErrOutput     = errors.New("Hedef mevcut, özel/boş değil veya yazılamıyor.")
	ErrArchive    = errors.New("Parola veya şifreli yedek geçersiz; işlem tamamlanmadı.")
)

func validPassphrase(passphrase string) bool {
	return len(passphrase) >= 12 && len(passphrase) <= 1024 && utf8.ValidString(passphrase) && !strings.ContainsAny(passphrase, "\r\n\x00")
}

// ReadPassphrase accepts only one UTF-8 line from stdin, with an optional final
// LF/CRLF. Read through EOF so additional lines cannot be silently ignored.
func ReadPassphrase(reader io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(reader, 1027))
	defer clear(data)
	if err != nil || len(data) == 1027 {
		return "", ErrPassphrase
	}
	if bytes.HasSuffix(data, []byte("\n")) {
		data = data[:len(data)-1]
		if bytes.HasSuffix(data, []byte("\r")) {
			data = data[:len(data)-1]
		}
	}
	passphrase := string(data)
	if !validPassphrase(passphrase) {
		return "", ErrPassphrase
	}
	return passphrase, nil
}

func openDirectory(path string, private bool) (*os.Root, error) {
	abs, err := filepath.Abs(path)
	if err != nil || strings.HasPrefix(abs, `\\`) {
		return nil, ErrOutput
	}
	info, err := os.Lstat(abs)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrOutput
	}
	root, err := os.OpenRoot(abs)
	if err != nil {
		return nil, ErrOutput
	}
	dir, err := root.Open(".")
	if err == nil {
		defer dir.Close()
		var actual os.FileInfo
		actual, err = dir.Stat()
		if err == nil && !os.SameFile(info, actual) {
			err = ErrOutput
		}
		if err == nil && private {
			err = requirePrivateDirectory(dir)
		}
	}
	if err != nil {
		root.Close()
		return nil, ErrOutput
	}
	return root, nil
}

func openRegular(root *os.Root, name string) (*os.File, os.FileInfo, error) {
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() {
		return nil, nil, ErrSource
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, nil, ErrSource
	}
	actual, err := file.Stat()
	if err != nil || !actual.Mode().IsRegular() || !os.SameFile(info, actual) {
		file.Close()
		return nil, nil, ErrSource
	}
	return file, actual, nil
}

type createdFile struct {
	name string
	info os.FileInfo
}

// Never delete a replacement file or anything not created by this call. Root
// confines both the identity check and removal to the originally opened dir.
func removeCreated(root *os.Root, created []createdFile) {
	for _, file := range created {
		info, err := root.Lstat(file.name)
		if err == nil && info.Mode().IsRegular() && os.SameFile(info, file.info) {
			_ = root.Remove(file.name)
		}
	}
}

func createFile(root *os.Root, name string) (*os.File, createdFile, error) {
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, createdFile{}, ErrOutput
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, createdFile{}, ErrOutput
	}
	return file, createdFile{name, info}, nil
}

func directoryEntries(root *os.Root) ([]os.DirEntry, error) {
	dir, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	// One lookahead beyond the only two allowed files bounds directory memory.
	entries, err := dir.ReadDir(3)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return entries, nil
}

func allowedSize(name string, size int64) bool {
	return size > 0 && ((name == "metadata.json" && size <= MaxMetadataBytes) || (name == "database.dump" && size <= MaxDumpBytes))
}

func Encrypt(sourceDirectory, outputPath, passphrase string) error {
	return encrypt(sourceDirectory, outputPath, passphrase, WorkFactor)
}

func encrypt(sourceDirectory, outputPath, passphrase string, workFactor int) error {
	if !validPassphrase(passphrase) {
		return ErrPassphrase
	}
	source, err := openDirectory(sourceDirectory, true)
	if err != nil {
		return ErrSource
	}
	defer source.Close()
	entries, err := directoryEntries(source)
	if err != nil || len(entries) != 2 {
		return ErrSource
	}
	names := []string{"metadata.json", "database.dump"}
	var files []*os.File
	var infos []os.FileInfo
	defer func() {
		for _, file := range files {
			file.Close()
		}
	}()
	for _, name := range names {
		file, info, err := openRegular(source, name)
		if err != nil {
			return ErrSource
		}
		files = append(files, file)
		infos = append(infos, info)
		if !allowedSize(name, info.Size()) {
			return ErrSource
		}
	}
	abs, err := filepath.Abs(outputPath)
	if err != nil {
		return ErrOutput
	}
	outputRoot, err := openDirectory(filepath.Dir(abs), false)
	if err != nil {
		return ErrOutput
	}
	defer outputRoot.Close()
	output, created, err := createFile(outputRoot, filepath.Base(abs))
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		output.Close()
		if !committed {
			removeCreated(outputRoot, []createdFile{created})
		}
	}()
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return ErrPassphrase
	}
	recipient.SetWorkFactor(workFactor)
	encrypted, err := age.Encrypt(output, recipient)
	if err != nil {
		return ErrArchive
	}
	archive := tar.NewWriter(encrypted)
	for i, name := range names {
		format := tar.FormatUSTAR
		if infos[i].Size() >= 8<<30 {
			format = tar.FormatPAX // Standard tar extension for large dump sizes.
		}
		if err := archive.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: infos[i].Size(), Typeflag: tar.TypeReg, Format: format}); err != nil {
			return ErrSource
		}
		if _, err := io.CopyN(archive, files[i], infos[i].Size()); err != nil {
			return ErrSource
		}
		// Reject a source that grew, shrank or changed metadata during copying.
		var extra [1]byte
		if n, err := files[i].Read(extra[:]); n != 0 || err != io.EOF {
			return ErrSource
		}
		after, err := files[i].Stat()
		if err != nil || after.Size() != infos[i].Size() || !after.ModTime().Equal(infos[i].ModTime()) {
			return ErrSource
		}
	}
	if archive.Close() != nil || encrypted.Close() != nil || output.Sync() != nil || output.Close() != nil {
		return ErrOutput
	}
	committed = true
	return nil
}

func validHeader(header *tar.Header) bool {
	if header.Typeflag != tar.TypeReg || header.Linkname != "" || !allowedSize(header.Name, header.Size) {
		return false
	}
	if header.Format == tar.FormatUSTAR {
		return len(header.PAXRecords) == 0
	}
	// Only the standard size extension needed by dumps >=8GiB is permitted.
	return header.Format == tar.FormatPAX && header.Name == "database.dump" && header.Size >= 8<<30 && len(header.PAXRecords) == 1 && header.PAXRecords["size"] == strconv.FormatInt(header.Size, 10)
}

func Decrypt(inputPath, outputDirectory, passphrase string) error {
	if !validPassphrase(passphrase) {
		return ErrPassphrase
	}
	destination, err := openDirectory(outputDirectory, true)
	if err != nil {
		return ErrOutput
	}
	defer destination.Close()
	entries, err := directoryEntries(destination)
	if err != nil || len(entries) != 0 {
		return ErrOutput
	}
	abs, err := filepath.Abs(inputPath)
	if err != nil {
		return ErrArchive
	}
	inputRoot, err := openDirectory(filepath.Dir(abs), false)
	if err != nil {
		return ErrArchive
	}
	defer inputRoot.Close()
	input, inputInfo, err := openRegular(inputRoot, filepath.Base(abs))
	if err != nil {
		return ErrArchive
	}
	defer input.Close()
	if inputInfo.Size() <= 0 || inputInfo.Size() > maxEncryptedSize {
		return ErrArchive
	}
	identity, err := age.NewScryptIdentity(passphrase)
	if err != nil {
		return ErrPassphrase
	}
	identity.SetMaxWorkFactor(WorkFactor)
	plaintext, err := age.Decrypt(input, identity)
	if err != nil {
		return ErrArchive
	}
	var created []createdFile
	committed := false
	defer func() {
		if !committed {
			removeCreated(destination, created)
		}
	}()
	archive := tar.NewReader(plaintext)
	seen := map[string]bool{}
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil || !validHeader(header) || seen[header.Name] || len(seen) == 2 {
			return ErrArchive
		}
		file, record, err := createFile(destination, header.Name)
		if err != nil {
			return ErrOutput
		}
		created = append(created, record)
		_, copyErr := io.CopyN(file, archive, header.Size)
		syncErr := file.Sync()
		closeErr := file.Close()
		if copyErr != nil || syncErr != nil || closeErr != nil {
			return ErrArchive
		}
		seen[header.Name] = true
	}
	if len(seen) != 2 {
		return ErrArchive
	}
	// tar EOF is not age EOF. Read every remaining byte to authenticate the
	// final chunk and detect truncated/tampered/trailing ciphertext. Standard
	// tar block padding is allowed only when zero-filled and bounded.
	var buffer [32 << 10]byte
	padding := 0
	for {
		n, err := plaintext.Read(buffer[:])
		padding += n
		if padding > maxTarPadding {
			return ErrArchive
		}
		for _, value := range buffer[:n] {
			if value != 0 {
				return ErrArchive
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return ErrArchive
		}
	}
	entries, err = directoryEntries(destination)
	if err != nil || len(entries) != 2 {
		return ErrOutput
	}
	committed = true
	return nil
}
