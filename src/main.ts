import {
  formatEnvironmentValidationError,
  parseEnvironment,
} from "./config/environment.js";
import { createApp } from "./http/create-app.js";

function start(): void {
  try {
    const config = parseEnvironment(process.env);
    const app = createApp();

    app.listen(config.port, config.host, () => {
      console.log(
        `Atlas Manager is listening on http://${config.host}:${config.port}.`,
      );
    });
  } catch (error) {
    const message = formatEnvironmentValidationError(error);

    if (message === undefined) {
      throw error;
    }

    console.error(message);
    process.exitCode = 1;
  }
}

start();
