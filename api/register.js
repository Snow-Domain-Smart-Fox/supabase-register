// 引入依赖
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置（请替换为你的实际值）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 初始化 Supabase 服务端客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * 生成随机密码（用于 Supabase 用户创建）
 * @returns {string} 随机密码
 */
function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
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
    // 1. 获取请求体中的 luoguuid
    const { luoguuid } = req.body;
    if (!luoguuid || typeof luoguuid !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请求体中必须包含有效的 luoguuid'
      });
    }

    // 2. 调用洛谷 API 获取用户信息
    const luoguApiUrl = `https://www.luogu.com.cn/api/user/info/${luoguuid}`;
    const luoguResponse = await fetch(luoguApiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.luogu.com.cn/'
      }
    });

    if (!luoguResponse.ok) {
      return res.status(404).json({
        success: false,
        message: `洛谷用户不存在或 API 请求失败 (${luoguResponse.status})`
      });
    }

    const luoguData = await luoguResponse.json();
    
    // 3. 验证 introduction 是否以指定内容开头
    const expectedPrefix = `Amazing Luogu Verifying: ${luoguuid}`;
    const userIntroduction = luoguData.user.introduction || '';
    
    if (!userIntroduction.startsWith(expectedPrefix)) {
      return res.status(403).json({
        success: false,
        message: `验证失败：用户简介未以 "${expectedPrefix}" 开头`,
        actualIntroduction: userIntroduction
      });
    }

    // 4. 提取洛谷用户信息（用于创建 Supabase 用户）
    const luoguUserEmail = luoguData.email || `${luoguuid}_${generateRandomPassword()}@luogu-verified.com`; // 备用邮箱
    const luoguUserName = luoguData.name || `luogu_user_${luoguuid}`;

    // 5. 生成随机密码（用户后续可自行重置）
    const randomPassword = generateRandomPassword();

    // 6. 使用 Service Key 创建 Supabase 用户
    const { data: supabaseData, error: supabaseError } = await supabase.admin.auth.createUser({
      email: luoguUserEmail,
      password: randomPassword,
      email_confirm: true, // 自动确认邮箱
      send_email_confirm: false // 不发送确认邮件
    });

    if (supabaseError) {
      throw new Error(`Supabase 创建用户失败: ${supabaseError.message}`);
    }

    // 7. 返回成功结果
    return res.status(200).json({
      success: true,
      message: '用户注册成功',
      userId: supabaseData.user.id,
      luoguInfo: {
        uid: luoguData.uid,
        name: luoguData.name,
        email: luoguUserEmail
      },
      // 注意：生产环境不要返回密码，这里仅用于测试
      temporaryPassword: randomPassword 
    });

  } catch (error) {
    console.error('注册流程异常:', error);
    return res.status(500).json({
      success: false,
      message: `服务器内部错误: ${error.message}`
    });
  }
};
