// Package nodeversion holds the single definition of the Node.js runtime range
// Atlas Manager supports on a deployment host.
//
// The declared source of truth is the "engines.node" field in package.json.
// TestSupportedRangeMatchesPackageEngines keeps this package aligned with it, so
// a change to engines that is not reflected here fails the build rather than
// silently splitting host qualification from the application contract.
//
// This is deliberately separate from bundle.PinnedNode, which pins the exact
// toolchain that produced a bundle for reproducibility. That pin must stay
// exact; the runtime a host provides only has to fall inside the supported
// range.
package nodeversion

import "strings"

const (
	// SupportedMajor is the only Node.js major release the deployment supports.
	SupportedMajor = "24"

	// Range mirrors the engines.node constraint in package.json.
	Range = ">=" + SupportedMajor + " <25"
)

// Supported reports whether the output of `node --version` names a release
// inside the supported range. Input is the raw command output; surrounding
// whitespace is ignored. Anything that is not a plain vMAJOR.MINOR.PATCH triple
// is rejected, including prerelease and build suffixes.
func Supported(output string) bool {
	value, found := strings.CutPrefix(strings.TrimSpace(output), "v")
	if !found {
		return false
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if !isCanonicalNumber(part) {
			return false
		}
	}
	return parts[0] == SupportedMajor
}

func isCanonicalNumber(value string) bool {
	if value == "" || len(value) > 6 {
		return false
	}
	if len(value) > 1 && value[0] == '0' {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
