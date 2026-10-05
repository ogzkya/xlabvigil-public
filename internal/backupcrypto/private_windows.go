//go:build windows

package backupcrypto

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func requirePrivateDirectory(directory *os.File) error {
	const fileFullControl = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return ErrOutput
	}
	sd, err := windows.GetSecurityInfo(windows.Handle(directory.Fd()), windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return ErrOutput
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(user.User.Sid) {
		return ErrOutput
	}
	dacl, _, err := sd.DACL()
	if err != nil || dacl == nil || dacl.AceCount == 0 {
		return ErrOutput
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return ErrOutput
	}
	inheritsFullControl := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(dacl, index, &ace) != nil {
			return ErrOutput
		}
		if ace.Header.AceType == windows.ACCESS_DENIED_ACE_TYPE {
			continue
		}
		// Fail closed on object/callback/unknown ACEs. Even inheritable allow
		// rules matter: decrypted children must not grant another principal.
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || !(*windows.SID)(unsafe.Pointer(&ace.SidStart)).Equals(user.User.Sid) {
			return ErrOutput
		}
		if ace.Header.AceFlags&(windows.OBJECT_INHERIT_ACE|windows.CONTAINER_INHERIT_ACE|windows.INHERIT_ONLY_ACE) == windows.OBJECT_INHERIT_ACE|windows.CONTAINER_INHERIT_ACE && ace.Mask&fileFullControl == fileFullControl {
			inheritsFullControl = true
		}
	}
	if !inheritsFullControl {
		return ErrOutput
	}
	return nil
}
