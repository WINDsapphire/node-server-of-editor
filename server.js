const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec); // 转为Promise风格，方便异步处理

const corsOptions = {
  origin: 'http://101.251.162.28:5000', 
  allowedHeaders: ['Content-Type', 'Authorization'], 
  methods: ['GET', 'POST', 'OPTIONS'], 
  credentials: true 
};

// 基础中间件
app.use(cors());
app.use(express.json());

// 根目录：存放所有用户的C代码
const USER_CODE_ROOT = path.join(__dirname, 'user_codes');
// 确保根目录存在
if (!fs.existsSync(USER_CODE_ROOT)) {
  fs.mkdirSync(USER_CODE_ROOT, { recursive: true });
}

/**
 * 编译并运行C代码接口
 * @param {string} req.body.userId - 用户唯一标识（必填）
 * @param {string} req.body.content - C代码内容（必填）
 */
app.post('/api/post-c-code', async (req, res) => {
  try {
    // 1. 校验参数
    const { userId, content } = req.body;
    if (!userId || !content) {
      return res.json({ 
        code: 400, 
        message: '用户ID和代码内容不能为空！' 
      });
    }

    // 2. 创建用户独立目录（路径拼接防注入）
    const userDir = path.join(USER_CODE_ROOT, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // 3. 写入C代码文件（固定文件名，简化编译逻辑）
    const cFilePath = path.join(userDir, 'main.c');
    fs.writeFileSync(cFilePath, content, 'utf8');

    // 4. 构建Docker编译命令
    const dockerCompileCmd = [
      'docker run --rm',
      `-v ${userDir}:/code`, // 挂载用户目录到容器内/code
      'gcc:latest', // 使用官方gcc镜像
      'gcc /code/main.c -o /code/main -Wall' // -Wall 显示所有编译警告
    ].join(' ');

    // 5. 执行编译命令并捕获编译结果
    let compileError = null;
    try {
      const { stderr: compileStderr } = await execAsync(dockerCompileCmd);
      if (compileStderr) {
        compileError = compileStderr; // 编译警告/错误
      }
    } catch (err) {
      compileError = err.stderr || err.message; // 编译失败（非0退出码）
    }

    // 编译失败则直接返回
    if (compileError) {
      return res.json({
        code: 400,
        message: 'C代码编译失败！',
        data: {
          compileError: compileError, // 编译错误/警告信息
          codeLength: content.length
        }
      });
    }

    // 6. 编译成功，构建运行命令（Docker内运行可执行文件）
    const dockerRunCmd = [
      'docker run --rm',
      `-v ${userDir}:/code`,
      'gcc:latest',
      '/code/main' // 运行编译后的可执行文件
    ].join(' ');

    // 7. 执行运行命令并捕获输出（含printf内容）
    let runOutput = '';
    let runError = '';
    try {
      const { stdout, stderr } = await execAsync(dockerRunCmd);
      runOutput = stdout; // printf的内容会输出到stdout
      runError = stderr; // 运行时错误（如段错误）输出到stderr
    } catch (err) {
      runError = err.stderr || err.message; // 运行失败的错误信息
    }

    // 8. 返回最终结果（编译+运行）
    res.json({
      code: 200,
      message: '代码编译并运行成功！',
      data: {
        codeLength: content.length,
        compileTip: '编译成功，无警告/错误',
        runOutput: runOutput || '程序运行无输出（printf可能为空）', // printf内容
        runError: runError, // 运行时错误（无则为空）
        userDir,
        executablePath: path.join(userDir, 'main')
      }
    });

  } catch (systemError) {
    // 系统级错误（如Docker未启动、目录权限问题）
    res.json({
      code: 500,
      message: '服务器执行出错！',
      data: {
        systemError: systemError.message
      }
    });
  }
});

// 测试接口
app.get('/api/hello', (req, res) => {
  res.json({ message: 'React + Node 联动成功' });
});

// 启动服务
app.listen(port, () => {
  console.log(`后端服务运行在 http://localhost:${port}`);
});