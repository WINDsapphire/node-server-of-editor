const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec); // 转为Promise风格，方便异步处理

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
 * 编译C代码接口
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
    // 核心：将用户目录挂载到容器的 /code 目录，编译 main.c 生成可执行文件 main
    // --rm：编译完成后删除容器；gcc:latest 是官方gcc镜像
    const dockerCmd = [
      'docker run --rm',
      `-v ${userDir}:/code`, // 挂载用户目录到容器内/code
      'gcc:latest', // 使用官方gcc镜像
      'gcc /code/main.c -o /code/main' // 容器内编译命令
    ].join(' ');

    // 5. 执行Docker编译命令
    const { stderr } = await execAsync(dockerCmd);
    if (stderr) {
      // 编译错误（如语法错误），返回错误信息
      return res.json({
        code: 400,
        message: 'C代码编译失败！',
        data: {
          error: stderr,
          length: content.length
        }
      });
    }

    // 6. 编译成功
    res.json({
      code: 200,
      message: '代码传输并编译成功！',
      data: {
        length: content.length,
        tip: '后端已收到并编译完成',
        userDir, // 用户目录路径
        executablePath: path.join(userDir, 'main') // 可执行文件路径
      }
    });

  } catch (error) {
    // 系统级错误（如Docker未启动、权限不足）
    res.json({
      code: 500,
      message: '服务器编译出错！',
      data: {
        error: error.message
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