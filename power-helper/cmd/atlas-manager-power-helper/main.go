package main

import (
	"os"

	helperruntime "github.com/atlas-manager/atlas-manager/power-helper/internal/runtime"
)

func main() {
	os.Exit(helperruntime.RunProcess())
}
