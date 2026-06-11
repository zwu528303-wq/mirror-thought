import { handleChatPayload } from '../server/jingguanRuntime.js';

async function readBody(req: any) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  return rawBody ? JSON.parse(rawBody) : {};
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持 POST 请求。' });
    return;
  }

  try {
    const result = await handleChatPayload(await readBody(req));
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(400).json({
      error: '请求体不是有效 JSON。',
      detail: error instanceof Error ? error.message : undefined,
    });
  }
}
