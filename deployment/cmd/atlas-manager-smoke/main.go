package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/atlas-manager/atlas-manager/deployment/internal/smoke"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "run" {
		fail("arguments_invalid")
	}
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	node := flags.String("node", "/usr/bin/node", "")
	root := flags.String("application-root", "", "")
	if err := flags.Parse(os.Args[2:]); err != nil || flags.NArg() != 0 || *root == "" {
		fail("arguments_invalid")
	}
	if err := smoke.Run(context.Background(), *node, *root); err != nil {
		fail(err.Error())
	}
}

func fail(code string) { fmt.Fprintln(os.Stderr, "atlas-manager-smoke: "+code); os.Exit(1) }
