// 引入依赖
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 初始化 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * 手动解析 Express 请求体（核心修复：确保100%能解析）
 * @param {Request} req - Express 请求对象
 * @returns {Promise<Object>} 解析后的 JSON 对象
 */
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    // 监听数据块
    req.on('data', (chunk) => chunks.push(chunk));
    // 监听结束
    req.on('end', () => {
      try {
        const bodyString = Buffer.concat(chunks).toString('utf8');
        // 空请求体返回空对象
        resolve(bodyString ? JSON.parse(bodyString) : {});
      } catch (err) {
        reject(new Error(`请求体解析失败: ${err.message}`));
      }
    });
    // 监听错误
    req.on('error', (err) => reject(err));
  });
}

/**
 * 验证邮箱密码并获取 luogu_uid
 */
async function verifyUserCredentials(email, password) {
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) throw new Error(`凭据验证失败: ${authError.message}`);
    if (!authData.user) throw new Error("未找到匹配的用户");

    const luoguUid = authData.user.user_metadata?.luogu_uid;
    if (!luoguUid) throw new Error("该用户未绑定洛谷 UID");

    return luoguUid;
  } catch (error) {
    throw new Error(`验证流程异常: ${error.message}`);
  }
}

/**
 * 更新用户最后在线时间
 */
async function updateUserLastSeen(luoguUid, lastSeen) {
  try {
    const { error: updateError } = await supabase
      .from('user_status')
      .upsert(
        { uid: Number(luoguUid), last_seen: lastSeen },
        { onConflict: 'uid', ignoreDuplicates: false }
      );

    if (updateError) throw new Error(`更新失败: ${updateError.message}`);
    return true;
  } catch (error) {
    throw new Error(`更新流程异常: ${error.message}`);
  }
}

/**
 * 主处理函数
 */
module.exports = async (req, res) => {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: '仅支持 POST 请求'
    });
  }

  try {
    // 核心修复：手动解析请求体（不依赖任何外部中间件）
    const body = await parseRequestBody(req);
    console.log('手动解析后的请求体:', body); // 现在能看到正确解析的对象

    // 读取参数
    const { email, password } = body;
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请求体中必须包含有效的 email 和 password',
        received: { email, password } // 调试用：返回实际收到的值
      });
    }

    // 验证凭据
    const luoguUid = await verifyUserCredentials(email, password);
    // 生成 UTC 时间
    const currentUTCTime = new Date().toISOString();
    // 更新在线时间
    await updateUserLastSeen(luoguUid, currentUTCTime);

    // 返回成功响应
    return res.status(200).json({
      success: true,
      message: '最后在线时间更新成功',
      data: { luogu_uid: luoguUid, last_seen: currentUTCTime }
    });

  } catch (error) {
    console.error('更新流程异常:', error);
    return res.status(500).json({
      success: false,
      message: `服务器内部错误: ${error.message}`
    });
  }
};
