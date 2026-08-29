import { env } from './config/env.js';
import { app } from './app.js';

app.listen(env.PORT, () => {
  console.log(`[API] Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
