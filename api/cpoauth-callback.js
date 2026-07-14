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
    body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f8fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { background: #fff; border-radius: 8px; padding: 32px; text-align: center; }
    h1 { margin: 0; font-size: 20px; font-weight: 600; color: #1f2937; }
    .error-message { margin-top: 12px; font-size: 14px; color: #ef4444; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${error ? '授权失败' : '授权成功'}</h1>
    ${error ? `<p class="error-message">${escapedError}</p>` : ''}
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