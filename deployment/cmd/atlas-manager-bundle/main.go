package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/atlas-manager/atlas-manager/deployment/internal/bundle"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "build" {
		fail("action_invalid")
	}
	flags := flag.NewFlagSet("build", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	version := flags.String("version", "", "")
	commit := flags.String("source-commit", "", "")
	epoch := flags.String("source-date-epoch", "", "")
	source := flags.String("source-root", "", "")
	output := flags.String("output-dir", "", "")
	nodeVersion := flags.String("node-version", bundle.PinnedNode, "")
	npmVersion := flags.String("npm-version", bundle.PinnedNPM, "")
	goVersion := flags.String("go-version", bundle.PinnedGo, "")
	if err := flags.Parse(os.Args[2:]); err != nil || flags.NArg() != 0 {
		fail("arguments_invalid")
	}
	parsedEpoch, err := strconv.ParseInt(*epoch, 10, 64)
	if err != nil || *epoch == "" || parsedEpoch < 0 || strconv.FormatInt(parsedEpoch, 10) != *epoch {
		fail("source_epoch_invalid")
	}
	executable, err := os.Executable()
	if err != nil {
		fail("executable_invalid")
	}
	result, err := bundle.Build(context.Background(), bundle.Config{
		Version: *version, SourceCommit: *commit, SourceDateEpoch: parsedEpoch,
		SourceRoot: *source, OutputDir: *output, NodeVersion: *nodeVersion,
		NPMVersion: *npmVersion, GoVersion: *goVersion,
		InstallerPath:     filepath.Join(filepath.Dir(executable), "atlas-manager-installer"),
		QualificationPath: filepath.Join(filepath.Dir(executable), "atlas-manager-host-qualification"),
	})
	if err != nil {
		fail(errorCode(err))
	}
	fmt.Println(result.Archive)
}

func fail(code string)           { fmt.Fprintln(os.Stderr, "atlas-manager-bundle: "+code); os.Exit(1) }
func errorCode(err error) string { return err.Error() }
