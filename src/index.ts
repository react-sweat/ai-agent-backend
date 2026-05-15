import 'dotenv/config';
import express from 'express';
import agentRouter from './agent/agent.router';

const app = express();
const PORT = process.env['PORT'] ?? 3000;

app.use(express.json());
app.use('/agent', agentRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
