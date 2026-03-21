// 引入依赖
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置（复用 register.js 的环境变量配置）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 初始化 Supabase 服务端客户端（复用 register.js 的配置）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * 验证邮箱密码并获取对应用户的 luogu_uid
 * @param {string} email - 用户邮箱
 * @param {string} password - 用户密码
 * @returns {Promise<string>} - 匹配用户的 luogu_uid
 */
async function verifyUserCredentials(email, password) {
  try {
    // 1. 先通过邮箱密码登录，验证凭据有效性（Supabase Auth 验证）
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (authError) {
      throw new Error(`凭据验证失败: ${authError.message}`);
    }

    if (!authData.user) {
      throw new Error("未找到匹配的用户");
    }

    // 2. 获取该用户的 luogu_uid（从用户元数据中提取）
    const luoguUid = authData.user.user_metadata?.luogu_uid;
    if (!luoguUid) {
      throw new Error("该用户未绑定洛谷 UID");
    }

    return luoguUid;
  } catch (error) {
    throw new Error(`验证流程异常: ${error.message}`);
  }
}

/**
 * 更新用户最后在线时间
 * @param {string} luoguUid - 洛谷 UID
 * @param {string} lastSeen - UTC 时间字符串
 * @returns {Promise<boolean>} - 更新是否成功
 */
async function updateUserLastSeen(luoguUid, lastSeen) {
  try {
    // 使用 Supabase PostgREST API 执行 upsert 操作（复用原逻辑的 merge-duplicates）
    const { error: updateError } = await supabase
      .from('user_status')
      .upsert(
        {
          uid: Number(luoguUid), // 转为数字类型，和原逻辑一致
          last_seen: lastSeen
        },
        {
          onConflict: 'uid', // 基于 uid 冲突时合并（对应 Prefer: resolution=merge-duplicates）
          ignoreDuplicates: false // 冲突时更新而非忽略
        }
      );

    if (updateError) {
      throw new Error(`更新失败: ${updateError.message}`);
    }

    return true;
  } catch (error) {
    throw new Error(`更新流程异常: ${error.message}`);
  }
}

/**
 * 主处理函数（Express 风格，和 register.js 一致）
 */
module.exports = async (req, res) => {
  // 只允许 POST 请求（复用 register.js 的请求方法校验）
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: '仅支持 POST 请求'
    });
  }

  try {
    // 1. 获取请求体中的邮箱、密码
    const { email, password } = req.body;
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      console.log(email,password);
      return res.status(400).json({
        success: false,
        message: '请求体中必须包含有效的 email 和 password'
      });
    }

    // 2. 验证邮箱密码，获取对应的 luogu_uid
    const luoguUid = await verifyUserCredentials(email, password);

    // 3. 生成当前 UTC 时间（ISO 格式，和原逻辑一致）
    const currentUTCTime = new Date().toISOString();

    // 4. 更新该用户的 last_seen 字段
    await updateUserLastSeen(luoguUid, currentUTCTime);

    // 5. 返回成功响应
    return res.status(200).json({
      success: true,
      message: '最后在线时间更新成功',
      data: {
        luogu_uid: luoguUid,
        last_seen: currentUTCTime
      }
    });

  } catch (error) {
    console.error('更新流程异常:', error);
    return res.status(500).json({
      success: false,
      message: `服务器内部错误: ${error.message}`
    });
  }
};
