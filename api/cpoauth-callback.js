// CP OAuth 回调接口
// 用于接收授权码并传递给用户脚本

/**
 * 手动解析 Express 请求体
 * @param {Request} req - Express 请求对象
 * @returns {Promise<Object>} 解析后的 JSON 对象
 */
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const bodyString = Buffer.concat(chunks).toString('utf8');
        resolve(bodyString ? JSON.parse(bodyString) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', (err) => resolve({}));
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = async (req, res) => {
  try {
    let code = req.query.code;
    let error = req.query.error;

    if (!code && req.method === 'POST') {
      const body = await parseRequestBody(req);
      code = body.code;
      error = body.error;
    }

    const escapedCode = escapeHtml(code || '');
    const escapedError = escapeHtml(error || '');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${error ? '授权失败' : '授权成功'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f6f8fa; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .container { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05); padding: 32px; max-width: 420px; width: 100%; text-align: center; }
    .icon { font-size: 48px; line-height: 1; margin-bottom: 16px; }
    .success-icon { color: #22c55e; }
    .error-icon { color: #ef4444; }
    h1 { font-size: 20px; font-weight: 600; color: #1f2937; margin-bottom: 8px; }
    .message { font-size: 14px; color: #6b7280; line-height: 1.5; }
    .progress { margin-top: 24px; }
    .progress-bar { height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; background: #6366f1; border-radius: 2px; animation: progress 1s ease-out forwards; }
    @keyframes progress { from { width: 0; } to { width: 100%; } }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
    .footer p { font-size: 12px; color: #9ca3af; }
    .footer a { color: #6366f1; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    ${error ? 
      `<div class="icon error-icon">✕</div>
      <h1>授权失败</h1>
      <p class="message">${escapedError}</p>` : 
      `<div class="icon success-icon">✓</div>
      <h1>授权成功</h1>
      <p class="message">正在返回 Amazing Luogu 插件...</p>
      <div class="progress">
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>`}
    <div class="footer">
      <p>Powered by <a href="https://github.com/Snow-Domain-Smart-Fox" target="_blank">Snow Domain Smart Fox</a></p>
    </div>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({
          type: '${error ? "cpoauth_error" : "cpoauth_code"}',
          code: '${escapedCode}',
          error: '${escapedError}'
        }, '*');
      }
      setTimeout(() => window.close(), ${error ? 3000 : 1500});
    } catch (e) {
      console.error('发送消息失败:', e);
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);

  } catch (err) {
    console.error('回调处理异常:', err);
    res.status(500).send('Internal Server Error');
  }
};