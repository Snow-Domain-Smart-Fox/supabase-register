// 引入依赖
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// CP OAuth 配置
const CP_OAUTH_CLIENT_ID = process.env.CP_OAUTH_CLIENT_ID || 'amazing-luogu';
const CP_OAUTH_CLIENT_SECRET = process.env.CP_OAUTH_CLIENT_SECRET;
const CP_OAUTH_TOKEN_URL = 'https://www.cpoauth.com/api/oauth/token';
const CP_OAUTH_USERINFO_URL = 'https://www.cpoauth.com/api/oauth/userinfo';

// 初始化 Supabase 服务端客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

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
        reject(new Error(`请求体解析失败: ${err.message}`));
      }
    });
    req.on('error', (err) => reject(new Error(`读取请求体失败: ${err.message}`)));
  });
}

/**
 * 生成随机密码
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
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: '仅支持 POST 请求'
    });
  }

  try {
    const body = await parseRequestBody(req);
    const { luoguuid, code, code_verifier, state } = body;

    if (!luoguuid || typeof luoguuid !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请求体中必须包含有效的 luoguuid'
      });
    }

    if (!code || !code_verifier) {
      return res.status(400).json({
        success: false,
        message: '缺少 CP OAuth 授权码或 code_verifier'
      });
    }

    if (!state) {
      return res.status(400).json({
        success: false,
        message: '缺少 state 参数'
      });
    }

    if (state !== luoguuid) {
      return res.status(403).json({
        success: false,
        message: 'state 参数验证失败，可能存在 CSRF 攻击',
        expectedState: luoguuid,
        receivedState: state
      });
    }

    const tokenResponse = await fetch(CP_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        code_verifier: code_verifier,
        client_id: CP_OAUTH_CLIENT_ID,
        client_secret: CP_OAUTH_CLIENT_SECRET,
        redirect_uri: 'https://online.amlg.top/api/cpoauth-callback'
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      return res.status(tokenResponse.status).json({
        success: false,
        message: `CP OAuth 令牌获取失败: ${errorData.error || errorData.error_description || '未知错误'}`
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const userinfoResponse = await fetch(CP_OAUTH_USERINFO_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userinfoResponse.ok) {
      return res.status(userinfoResponse.status).json({
        success: false,
        message: `获取用户信息失败 (${userinfoResponse.status})`
      });
    }

    const userinfoData = await userinfoResponse.json();

    const linkedAccounts = userinfoData.linked_accounts || [];
    const luoguAccount = linkedAccounts.find(acc => acc.platform === 'luogu');

    if (!luoguAccount) {
      return res.status(403).json({
        success: false,
        message: '用户未绑定洛谷账号，请先在 CP OAuth 绑定洛谷账号'
      });
    }

    if (luoguAccount.platformUid !== luoguuid) {
      return res.status(403).json({
        success: false,
        message: `绑定的洛谷账号 UID (${luoguAccount.platformUid}) 与请求的 UID (${luoguuid}) 不匹配`,
        actualUid: luoguAccount.platformUid,
        requestedUid: luoguuid
      });
    }

    const { data: passwordRow } = await supabase
        .from('user_passwords')
        .select('email, password')
        .eq('luogu_uid', luoguuid)
        .single();

    if (passwordRow && passwordRow.email && passwordRow.password) {
      if (passwordRow.email.startsWith(`${luoguuid}_`)) {
        console.log(`[Register Cache] 用户 ${luoguuid} 已存在，直接返回`);
        return res.status(200).json({
          success: true,
          message: '用户已注册，直接返回',
          email: passwordRow.email,
          temporaryPassword: passwordRow.password
        });
      } else {
        console.log(`[Register Cache] 用户 ${luoguuid} 邮箱不匹配，删除旧数据并重新注册`);
        await supabase.from('user_passwords').delete().eq('luogu_uid', luoguuid);
      }
    }

    const emailSuffix = Array.from({ length: 8 }, () => 
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
    ).join('');
    const userEmail = `${luoguuid}_${emailSuffix}@cpoauth-verified.com`;
    const userName = userinfoData.display_name || userinfoData.username || `cpoauth_user_${luoguuid}`;

    const randomPassword = generateRandomPassword();

    const { data: supabaseData, error: supabaseError } = await supabase.auth.admin.createUser({
      email: userEmail,
      password: randomPassword,
      email_confirm: true,
      send_email_confirm: false,
      user_metadata: {
        luogu_uid: luoguuid,
        cpoauth_sub: userinfoData.sub,
        cpoauth_username: userinfoData.username
      }
    });

    if (supabaseError) {
      throw new Error(`Supabase 创建用户失败: ${supabaseError.message}`);
    }

    const { error: insertError } = await supabase
      .from('user_passwords')
      .upsert({
        luogu_uid: luoguuid,
        email: userEmail,
        password: randomPassword
      }, {
        onConflict: 'luogu_uid'
      });

    if (insertError) {
      throw new Error(`保存密码映射失败: ${insertError.message}`);
    }

    return res.status(200).json({
      success: true,
      message: '用户注册成功',
      userId: supabaseData.user.id,
      email: userEmail,
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