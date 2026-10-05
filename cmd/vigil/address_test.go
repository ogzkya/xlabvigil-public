package main

import (
	"errors"
	"testing"
)

func TestLoopbackAddressAcceptsOnlyCanonicalLocalUnprivilegedPorts(t *testing.T) {
	tests := []struct {
		name, value, want string
	}{
		{"default", "", "127.0.0.1:8320"},
		{"existing-main", "127.0.0.1:8320", "127.0.0.1:8320"},
		{"existing-preview", "127.0.0.1:8321", "127.0.0.1:8321"},
		{"independent-pilot", "127.0.0.1:40215", "127.0.0.1:40215"},
		{"lower-bound", "127.0.0.1:1024", "127.0.0.1:1024"},
		{"upper-bound", "127.0.0.1:65535", "127.0.0.1:65535"},
		{"privileged-port", "127.0.0.1:1023", ""},
		{"zero-port", "127.0.0.1:0", ""},
		{"overflow-port", "127.0.0.1:65536", ""},
		{"large-integer", "127.0.0.1:18446744073709551616", ""},
		{"empty-port", "127.0.0.1:", ""},
		{"missing-port", "127.0.0.1", ""},
		{"leading-zero", "127.0.0.1:08320", ""},
		{"lower-bound-leading-zero", "127.0.0.1:01024", ""},
		{"positive-sign", "127.0.0.1:+8320", ""},
		{"negative-port", "127.0.0.1:-8320", ""},
		{"hex-port", "127.0.0.1:0x2080", ""},
		{"scientific-port", "127.0.0.1:1e4", ""},
		{"port-separator", "127.0.0.1:65_535", ""},
		{"service-name", "127.0.0.1:http", ""},
		{"unicode-digits", "127.0.0.1:８３２０", ""},
		{"arabic-digits", "127.0.0.1:٨٣٢٠", ""},
		{"hostname", "localhost:8320", ""},
		{"remote-ip", "192.0.2.1:8320", ""},
		{"other-loopback-ip", "127.0.0.2:8320", ""},
		{"short-loopback-ip", "127.1:8320", ""},
		{"leading-zero-ip", "127.000.0.1:8320", ""},
		{"wildcard-ip", "0.0.0.0:8320", ""},
		{"wildcard-host", ":8320", ""},
		{"ipv6-loopback", "[::1]:8320", ""},
		{"ipv4-mapped-ipv6", "[::ffff:127.0.0.1]:8320", ""},
		{"bracketed-ipv4", "[127.0.0.1]:8320", ""},
		{"leading-space", " 127.0.0.1:8320", ""},
		{"trailing-space", "127.0.0.1:8320 ", ""},
		{"port-space", "127.0.0.1: 8320", ""},
		{"trailing-newline", "127.0.0.1:8320\n", ""},
		{"trailing-carriage-return", "127.0.0.1:8320\r", ""},
		{"trailing-nul", "127.0.0.1:8320\x00", ""},
		{"whitespace-only", "\t ", ""},
		{"url", "http://127.0.0.1:8320", ""},
		{"path", "127.0.0.1:8320/path", ""},
		{"query", "127.0.0.1:8320?pilot=true", ""},
		{"multiple-ports", "127.0.0.1:8320:8321", ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := loopbackAddress(test.value)
			if test.want == "" {
				if got != "" || !errors.Is(err, errListenAddress) {
					t.Fatalf("invalid address accepted: %q, %v", got, err)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("address = %q, %v; want %q", got, err, test.want)
			}
		})
	}
}

func TestRunRejectsInvalidAddressBeforeStartupDependencies(t *testing.T) {
	// No web build or usable database configuration exists in this workspace.
	// Returning the address error proves these startup checks did not run first.
	t.Chdir(t.TempDir())
	t.Setenv("VIGIL_DATABASE_URL", "invalid-database-configuration")
	for _, address := range []string{"0.0.0.0:8320", "localhost:8320", "127.0.0.1:0", "127.0.0.1:08320", "127.0.0.1:65536"} {
		t.Setenv("VIGIL_ADDR", address)
		if err := run(); !errors.Is(err, errListenAddress) {
			t.Fatalf("address was not rejected before startup dependencies: %v", err)
		}
	}
}
