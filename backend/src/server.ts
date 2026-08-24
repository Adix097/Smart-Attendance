import app from './app.js';
import { config } from './config.js';

app.listen(config.port, config.host, () => {
  console.log(`Backend listening on http://${config.host}:${config.port}`);
  if (config.allowEndedSessionTest) {
    console.warn(
      '[attendance] ALLOW_ENDED_SESSION_TEST=true. The attendance page can offer the most recent ended class. Unset this variable after the pipeline test.',
    );
  }
});
