//go:build !windows

package backupcrypto

import "os"

func requirePrivateDirectory(directory *os.File) error {
	info, err := directory.Stat()
	if err != nil || info.Mode().Perm()&0077 != 0 {
		return ErrOutput
	}
	return nil
}
