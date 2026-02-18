<div align="center">

<img src="img/logo_title.png" height="100px">

### The Ultimate No/Low-Code Backend API Builder

---

### ✨ **Build APIs Visually, Deploy Instantly**

<img alt="banner" src="img/banner.png" height="350px">

Create complex backend APIs through an intuitive drag-and-drop interface. No coding required, but fully extensible for advanced use cases.

</div>

## 🚀 **Quick Start**
1. Goto [Fluxify's Docker Repository](https://github.com/Fluxify-rest/Fluxify/pkgs/container/fluxify-kit)
2. Pull the image
    ```bash
    docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
    ```
3. Create a `.env` file and use the variables from the [env.example](env.example)
3. Run the image
    ```bash
    docker run -d --env-file .env -p 8080:8080 ghcr.io/fluxify-rest/fluxify-kit:latest
    ```
4. Goto http://localhost:8080 to access the application running behind proxy server

---

## 📈 **Features**

- ✅ Visual drag-and-drop editor
- ✅ Core block library
- ✅ REST API generation
- ✅ PostgreSQL integration
- ✅ TypeScript support
- ✅ Secrets Management: Secure loading and saving of secrets
- ✅ **Multi-user Authentication**: User management system
- 💾 Database Interaction Blocks: Native database operation blocks
    - ✅ PostgreSQL
    - MySQL / MongoDB / Others (Looking for contributors)
- 🔍 Observability: Native observability blocks
    - Logging
        - ✅ Open Observe
        - Loki Logs
- 🤖 **AI Integration**: AI-powered API generation (**Ongoing**)
- 🔑 **JWT Blocks**: JSON Web Token handling and validation
- ☁️ **Serverless Support**: Deploy to serverless functions
- ⏰ **Cron Support**: Scheduled task execution
- 🗒️ **Audit Logs**: Execution history and trails
- 🔄 **Realtime Capabilities**: Live collaboration features
- 💽 **Backups**: Automated data backup systems
- 🛒 **Marketplace**: Online hub for blocks built by community

---

## 📊 **Contributing**

Found a bug 🐛 or have a feature idea? Please open an issue or submit a pull request to an existing issue.

---

## 📄 **License**

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
