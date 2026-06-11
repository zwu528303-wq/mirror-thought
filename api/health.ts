import { handleHealthPayload } from '../server/jingguanRuntime';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: '只支持 GET 请求。' });
    return;
  }

  const result = await handleHealthPayload();
  if (req.method === 'HEAD') {
    res.status(result.status).end();
    return;
  }

  res.status(result.status).json(result.body);
}
