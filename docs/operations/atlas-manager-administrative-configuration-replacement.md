# Administrative configuration replacement and rollback

Administrative configuration replacement and rollback are disabled-service
operations. They discover only `atlas-manager.mock-admin.input.json`, require
exact operation confirmations, validate the full profile, preserve one managed
previous generation, and never activate or restart the service. Missing
administrators, modified state, unknown generations, and interrupted
transactions fail closed.
