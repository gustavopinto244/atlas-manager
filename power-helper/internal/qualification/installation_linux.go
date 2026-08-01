//go:build linux

package qualification

import "github.com/atlas-manager/atlas-manager/power-helper/internal/installer"

type ManagedInstallation struct{ value installer.Installer }

func NewManagedInstallation(bundleRoot string) ManagedInstallation {
	return ManagedInstallation{value: installer.NewProduction(bundleRoot)}
}

func (installation ManagedInstallation) Fresh() error {
	status, err := installation.value.InspectManaged()
	if err != nil || status != installer.StatusNotInstalled {
		return installer.ErrInstallationInvalid
	}
	return nil
}

func (installation ManagedInstallation) Disabled() error {
	status, err := installation.value.InspectManaged()
	if err != nil || status != installer.StatusValid {
		return installer.ErrInstallationInvalid
	}
	return nil
}

func (installation ManagedInstallation) Removed() error {
	status, err := installation.value.InspectRemoved()
	if err != nil || status != installer.StatusNotInstalled {
		return installer.ErrInstallationInvalid
	}
	return nil
}
