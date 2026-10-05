package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"xlabvigil/internal/backupcrypto"
)

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stderr)) }

func run(args []string, stdin io.Reader, stderr io.Writer) int {
	if len(args) == 0 || (args[0] != "encrypt" && args[0] != "decrypt") {
		fmt.Fprintln(stderr, "Kullanım: vigil-backup encrypt --source-dir DIZIN --output DOSYA veya decrypt --input DOSYA --output-dir DIZIN")
		return 2
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(io.Discard) // Parse errors must never echo provided values.
	var source, output, input, directory string
	if args[0] == "encrypt" {
		flags.StringVar(&source, "source-dir", "", "")
		flags.StringVar(&output, "output", "", "")
	} else {
		flags.StringVar(&input, "input", "", "")
		flags.StringVar(&directory, "output-dir", "", "")
	}
	if flags.Parse(args[1:]) != nil || flags.NArg() != 0 || (args[0] == "encrypt" && (source == "" || output == "")) || (args[0] == "decrypt" && (input == "" || directory == "")) {
		fmt.Fprintln(stderr, "İşlem ve dosya/dizin argümanları geçersiz.")
		return 2
	}
	passphrase, err := backupcrypto.ReadPassphrase(stdin)
	if err == nil {
		if args[0] == "encrypt" {
			err = backupcrypto.Encrypt(source, output, passphrase)
		} else {
			err = backupcrypto.Decrypt(input, directory, passphrase)
		}
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
