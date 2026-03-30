// 引入依赖
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置（只需要 SERVICE，全程用它）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 初始化：仅用 SERVICE KEY，关闭所有 auth 持久化
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

/**
 * 手动解析 Express 请求体
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
        reject(new Error(`请求体解析失败: ${err.message}`));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

/**
 * 验证邮箱密码（用 SERVICE KEY 也能登录！）
 * 关键：登录后立即清除会话，保持 SERVICE 最高权限
 */
async function verifyUserCredentials(email, password) {
  try {
    // 用 SERVICE KEY 登录
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    // 登录完立即销毁会话 → 强制保持 SERVICE 权限
    await supabase.auth.signOut();

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
 * 更新用户最后在线时间（100% 跳过 RLS）
 */
async function updateUserLastSeen(luoguUid, lastSeen, format) {
  try {
    const { error: updateError } = await supabase
      .from('user_status')
      .upsert(
        { uid: Number(luoguUid), last_seen: lastSeen, format: format },
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
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: '仅支持 POST 请求'
    });
  }

  try {
    const body = await parseRequestBody(req);
    const { email, password, format } = body;

    if (!email || !password || !format) {
      return res.status(400).json({
        success: false,
        message: '必须包含 email, password, format'
      });
    }

    // 1. 验证用户（SERVICE KEY 登录，立即登出保持权限）
    const luoguUid = await verifyUserCredentials(email, password);

    // 2. 跳过 RLS 写入数据库
    const currentUTCTime = new Date().toISOString();
    await updateUserLastSeen(luoguUid, currentUTCTime, format);

    return res.status(200).json({
      success: true,
      message: '最后在线时间更新成功',
      data: { luogu_uid: luoguUid, last_seen: currentUTCTime, format }
    });

  } catch (error) {
    console.error('错误：', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
