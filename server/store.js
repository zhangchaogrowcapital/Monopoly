// 极简 JSON 文件存储（原子写入 + 防抖），适合小规模部署
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.data = defaults;
    this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (e) {
        console.error(`[store] 读取 ${file} 失败，使用空数据`, e);
      }
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
