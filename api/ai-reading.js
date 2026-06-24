// Vercel Serverless Function - AI解盤代理
// 路徑: /api/ai-reading
// 用途: 保護API金鑰不暴露在前端，並可在此處做次數控管

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, provider } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: '缺少 prompt' });
  }

  try {
    if (provider === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'DeepSeek API error');
      const text = data.choices?.[0]?.message?.content || '無法取得解盤';
      return res.status(200).json({ text });
    } else {
      // 預設使用 Claude
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || 'Claude API error');
      const text = data.content?.find(c => c.type === 'text')?.text || '無法取得解盤';
      return res.status(200).json({ text });
    }
  } catch (e) {
    console.error('AI reading error:', e);
    return res.status(500).json({ error: e.message });
  }
}
