package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/bundle"
)

const defaultGoVersion = "1.23.0"

func main() {
	if len(os.Args) < 2 || os.Args[1] != "build" {
		fmt.Fprintln(os.Stderr, "bundle build action required")
		os.Exit(64)
	}
	flags := flag.NewFlagSet("build", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	version := flags.String("version", "", "")
	sourceCommit := flags.String("source-commit", "", "")
	sourceDate := flags.String("source-date-epoch", "", "")
	sourceRoot := flags.String("source-root", "", "")
	outputDir := flags.String("output-dir", "", "")
	goVersion := flags.String("go-version", defaultGoVersion, "")
	if err := flags.Parse(os.Args[2:]); err != nil || flags.NArg() != 0 {
		os.Exit(64)
	}
	if err := build(*version, *sourceCommit, *sourceDate, *sourceRoot, *outputDir, *goVersion); err != nil {
		fmt.Fprintln(os.Stderr, "bundle build failed")
		os.Exit(70)
	}
}

func build(version, sourceCommit, sourceDate, sourceRoot, outputDir, goVersion string) error {
	if err := bundle.ValidatePackageVersion(version); err != nil || sourceRoot == "" || outputDir == "" || goVersion == "" {
		return errors.New("invalid build metadata")
	}
	var err error
	if sourceRoot, err = filepath.Abs(sourceRoot); err != nil {
		return errors.New("invalid source root")
	}
	if outputDir, err = filepath.Abs(outputDir); err != nil {
		return errors.New("invalid output directory")
	}
	repositoryRoot := sourceRoot
	moduleRoot := filepath.Join(sourceRoot, "power-helper")
	if _, statErr := os.Stat(filepath.Join(sourceRoot, "go.mod")); statErr == nil {
		moduleRoot = sourceRoot
		repositoryRoot = filepath.Dir(sourceRoot)
	}
	epoch, err := bundle.ParseSourceDateEpoch(sourceDate)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}
	topName := fmt.Sprintf("%s_%s_linux_amd64", bundle.Name, version)
	bundleRoot := filepath.Join(outputDir, topName)
	archivePath := filepath.Join(outputDir, bundle.ArchiveName(version))
	if _, err := os.Lstat(bundleRoot); err == nil {
		return errors.New("output bundle already exists")
	}
	if _, err := os.Lstat(archivePath); err == nil {
		return errors.New("output archive already exists")
	}
	buildDir, err := os.MkdirTemp(outputDir, ".power-helper-build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(buildDir)
	helperPath := filepath.Join(buildDir, "atlas-manager-power-helper")
	installerPath := filepath.Join(buildDir, "atlas-manager-power-helper-installer")
	qualificationPath := filepath.Join(buildDir, "atlas-manager-power-helper-host-qualification")
	for _, target := range []struct{ output, packagePath string }{
		{helperPath, "./cmd/atlas-manager-power-helper"},
		{installerPath, "./cmd/atlas-manager-power-helper-installer"},
		{qualificationPath, "./cmd/atlas-manager-power-helper-host-qualification"},
	} {
		if err := runGoBuild(moduleRoot, target.output, target.packagePath, epoch); err != nil {
			return err
		}
	}
	helper, err := os.ReadFile(helperPath)
	if err != nil {
		return err
	}
	installer, err := os.ReadFile(installerPath)
	if err != nil {
		return err
	}
	qualification, err := os.ReadFile(qualificationPath)
	if err != nil {
		return err
	}
	manifest := bundle.BuildManifest(version, sourceCommit, goVersion, epoch, helper, installer, qualification)
	if err := os.MkdirAll(bundleRoot, 0755); err != nil {
		return err
	}
	documentation, err := os.ReadFile(filepath.Join(repositoryRoot, "docs", "operations", "linux-power-helper-installation.md"))
	if err != nil {
		return err
	}
	if err := bundle.CreateDirectoryBundle(bundleRoot, manifest, helper, installer, qualification, documentation); err != nil {
		return err
	}
	return bundle.CreateArchive(bundleRoot, archivePath, epoch)
}

func runGoBuild(moduleRoot, output, packagePath string, epoch uint64) error {
	command := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", output, packagePath)
	command.Dir = moduleRoot
	command.Env = fixedBuildEnvironment(epoch)
	return command.Run()
}

func fixedBuildEnvironment(epoch uint64) []string {
	result := make([]string, 0, len(os.Environ())+4)
	for _, value := range os.Environ() {
		if strings.HasPrefix(value, "CGO_ENABLED=") || strings.HasPrefix(value, "GOOS=") || strings.HasPrefix(value, "GOARCH=") || strings.HasPrefix(value, "GOAMD64=") || strings.HasPrefix(value, "SOURCE_DATE_EPOCH=") {
			continue
		}
		result = append(result, value)
	}
	result = append(result, "CGO_ENABLED=0", "GOOS=linux", "GOARCH=amd64", "GOAMD64=v1", fmt.Sprintf("SOURCE_DATE_EPOCH=%d", epoch))
	return result
}
