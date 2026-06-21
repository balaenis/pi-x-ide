# 发布 JetBrains 插件到 Marketplace

这篇笔记记录如何把 `ide-plugins/jetbrains` 下的 Pi x IDE 插件签名并发布到 [JetBrains Marketplace](https://plugins.jetbrains.com/)，以及如何让 GitHub Actions 在 release 时自动发布后续版本。

插件标识：

```text
plugin id  = balaenis.pi-x-ide      # Marketplace 唯一标识，发布后不可改
group      = com.balaenis.pixide    # Gradle 项目坐标，与 plugin id 无关
```

`plugin id` 和 `group` 是两个独立概念，设置在不同文件：

| 字段 | 设置位置 | 说明 |
| --- | --- | --- |
| **plugin id** | `src/main/resources/META-INF/plugin.xml` 的 `<id>`（权威来源） | IDE 与 Marketplace 实际读取的唯一标识，**发布后不可更改**，改了会被当成另一个插件 |
| **plugin id** | `build.gradle.kts` 的 `intellijPlatform.pluginConfiguration.id` | 构建期配置，必须与 `plugin.xml` 的 `<id>` 一致 |
| **group** | `gradle.properties` 的 `pluginGroup` | Gradle/Maven 坐标命名空间，`build.gradle.kts` 通过 `providers.gradleProperty("pluginGroup")` 读取 |
| name | `plugin.xml` 的 `<name>` + `gradle.properties` 的 `pluginName` | 展示名 |
| vendor | `plugin.xml` 的 `<vendor>` | Marketplace 页面展示的作者信息 |

> 修改 plugin id 时，`plugin.xml` 的 `<id>` 和 `build.gradle.kts` 的 `pluginConfiguration.id` 必须同步改；但插件一旦在 Marketplace 上架，**不要再改 id**。

## 核心约束（先读这一段）

1. **首次必须手动上传。** JetBrains 规定新插件的第一个版本只能在网页上手动上传，`publishPlugin` 这个自动任务只能用于「更新已存在的插件」。在插件 id `balaenis.pi-x-ide` 没有被人工首传并过审之前，CI 自动发布会失败。
2. **首次手动上传不需要 `PUBLISH_TOKEN`。** token 是 CI 自动上传用的凭证；网页手动上传走的是浏览器登录态。两者无关。
3. **签名密钥要从第一版起固定。** Marketplace 会记住你首版使用的签名公钥，之后所有版本必须用同一把私钥签名。换密钥要走人工重新登记，很麻烦。所以建议首次手动上传就用最终那把密钥签名。
4. **签名与 token 解耦。** 签名是本地 `gradle` 行为，token 是上传凭证，互不依赖。

## 总体流程

```text
首次（人工，一次性）                       后续（CI 自动，每次 release）
────────────────────────                ──────────────────────────────
1. 生成签名密钥对（永久保存）              1. release-please bump 版本
2. 本地 signPlugin 出签名 zip             2. CI signPlugin 签名
3. Marketplace 手动首传 + 过审            3. CI publishPlugin 上传
4. 生成 PUBLISH_TOKEN                     4. 进入 JetBrains 审核队列
5. 配置 4 个 GitHub Secrets               5. 过审后自动上架（仍需审核）
```

注意：**即使是 CI 自动发布的更新版本，每次也要重新过 JetBrains 审核**（自动检查 + Plugin Verifier + 人工 review），不是传上去立刻可见。

## 1. 生成签名密钥对

在本机生成一对密钥，**离线长期保存**：

```bash
# 1. 生成带密码的 RSA 私钥
openssl genpkey -aes-256-cbc -algorithm RSA \
  -out private_encrypted.pem -pkeyopt rsa_keygen_bits:4096

# 2. 用私钥自签一条证书链（10 年有效期）
openssl req -key private_encrypted.pem -new -x509 -days 3650 -out chain.crt
```

产物：

- `private_encrypted.pem` —— 私钥（加密的，对应 `PRIVATE_KEY_PASSWORD`）
- `chain.crt` —— 证书链（公开部分）
- 私钥密码本身

### 保存要求

- **私钥 + 密码必须存进密码管理器**（1Password / Bitwarden 等）或加密离线存储。这是唯一的恢复来源。
- GitHub Secret 只能写不能读，**不算备份**。
- 密码和私钥**分开记**，不要写在同一个明文文件里。
- 证书链是公开的，泄露无所谓；私钥 + 密码是机密。
- 这把私钥的生命周期 = 插件的生命周期，**跨所有版本复用同一把**。

> 仓库的 `ide-plugins/jetbrains/.gitignore` 已经忽略 `*.pem`、`*.crt`、`*.key`，避免误提交。但仍建议把密钥文件放到仓库目录之外。

## 2. 本地签名出 zip

推荐用 mise task，把密钥文件放到签名目录后一条命令完成签名（不需 token）：

```bash
# 1. 准备签名目录（默认 ~/.pi/jetbrains-signing/，可用 JETBRAINS_SIGNING_DIR 覆盖）
mkdir -p ~/.pi/jetbrains-signing
cp /path/to/chain.crt           ~/.pi/jetbrains-signing/chain.crt
cp /path/to/private_encrypted.pem ~/.pi/jetbrains-signing/private.pem

# 2. 设密码并签名
export PRIVATE_KEY_PASSWORD='你的私钥密码'
mise run package:jetbrains:sign
```

`package:jetbrains:sign` 会：从签名目录读 `chain.crt` / `private.pem`，从 `PRIVATE_KEY_PASSWORD` 读密码，映射成 gradle 需要的环境变量，再跑 `./gradlew signPlugin`。任何一项缺失都会报错并提示怎么配。

> `signPlugin` 依赖 `buildPlugin`，所以这一条命令同时完成「编译 + 打包 + 签名」，**不需要先跑 `package:jetbrains`**。

额外参数会透传给 gradle，例如 `mise run package:jetbrains:sign -- --info --stacktrace`。

### 底层原理

`build.gradle.kts` 的 `signing {}` 从环境变量读签名材料，`package:jetbrains:sign` task 只是把文件内容填进这些变量：

```kotlin
signing {
    certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
    privateKey = providers.environmentVariable("PRIVATE_KEY")
    password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
}
```

如果不用 task，也可以手动设变量后直接跑 gradle（效果等价）：

```bash
cd ide-plugins/jetbrains
export CERTIFICATE_CHAIN="$(cat /path/to/chain.crt)"
export PRIVATE_KEY="$(cat /path/to/private_encrypted.pem)"
export PRIVATE_KEY_PASSWORD='你的私钥密码'
./gradlew signPlugin
```

签名后的 zip 在：

```text
ide-plugins/jetbrains/build/distributions/pi-x-ide-jetbrains-<version>.zip
```

> 注意：`mise run package:jetbrains` 跑的是 `buildPlugin`，产出的是**未签名** zip。要签名版必须单独跑 `signPlugin`（它会先 `buildPlugin` 再签名），且环境变量要先设好。

### 验证签名生效

签名后建议先确认签名有效，再拿去上传。按从快到权威排列：

**方法 1：mise task（推荐）**

用 JetBrains 官方的 Marketplace ZIP Signer 库校验（Gradle 的 `verifyPluginSignature` 任务）：

```bash
export PRIVATE_KEY_PASSWORD='你的私钥密码'
mise run package:jetbrains:verify-signature
```

- 签名有效 → `BUILD SUCCESSFUL`
- 签名无效 / 未签名 → 报错退出

这个 task 与 `package:jetbrains:sign` 读取相同的签名目录（`~/.pi-toolset/pi-x-ide/jetbrains/`，可用 `JETBRAINS_SIGNING_DIR` 覆盖），且依赖 `signPlugin`，所以会按需先签名再校验。

> task 内部已处理 `verifyPluginSignature` 在 intellij-platform-gradle-plugin 2.16.0 的一个 bug（证书内容被当作多余 CLI 参数传递），通过 `certificateChainFile` + `--no-configuration-cache` 绕过。直接跑 `./gradlew verifyPluginSignature` 会踩到这个 bug，见「常见错误」。

**方法 2：看产物文件名**

`signPlugin` 成功后，`build/distributions/` 下会多出带 `-signed` 后缀的 zip：

```text
pi-x-ide-jetbrains-<version>-signed.zip   # 签名版
pi-x-ide-jetbrains-<version>.zip          # 未签名版
```

有 `-signed.zip` 说明签名任务跑完了，但「跑完」不等于「签名正确」，仍以方法 1 为准。

**方法 3：检查 zip 内的签名块**

```bash
unzip -l build/distributions/pi-x-ide-jetbrains-*-signed.zip | grep -iE 'signature|META-INF'
```

签名版会在 `META-INF/` 下带签名相关文件。

**方法 4：IDE 实际安装（最终判据）**

把签名 zip 装进 IDE（`Settings → Plugins → ⚙️ → Install Plugin from Disk`）：

- 签名有效 → 安装无警告，插件信息显示已签名
- 未签名 / 签名无效 → 弹出「Plugin was not signed」警告框

## 3. 手动首次上传并过审

1. 用个人 JetBrains 账号登录 [JetBrains Marketplace](https://plugins.jetbrains.com/)。
2. 进入用户菜单，选择 **Upload plugin**。
3. 选择或创建 **Vendor profile**。首次会要求接受 Developer Agreement 并填写 vendor 信息（个人或组织，需声明 trader / non-trader）。
4. 上传第 2 步产出的**签名 zip**，填写插件详情（描述、tags、license 等）。
5. 提交后进入审核队列。审核含：上传自动检查 → Plugin Verifier 兼容性检查 → 自动测试 → 人工 review。
6. 通常 2 个工作日内有结果；超过 3–4 个工作日没消息可邮件 `marketplace@jetbrains.com`。

过审上架后，插件 id `balaenis.pi-x-ide` 才正式存在于 Marketplace，CI 才能接管后续版本。

> 如果是 alpha / beta / EAP 版本，不想公开可见，可在上传时设置 **Custom Release Channel**。

## 4. 生成 PUBLISH_TOKEN

1. 打开：

   ```text
   https://plugins.jetbrains.com/author/me/tokens
   ```

2. 点击 **Generate New Token**。
3. 填写：
   - **Name**：`pi-x-ide-ci`（便于识别）
   - **Scope**：必须选 **Marketplace**
   - **Expiration**：建议 1 年
4. 点击 **Generate Token**，token 形如 `perm:XXXXXXXX...`。
5. **立刻复制并保存** —— 离开页面后无法再查看。

> JetBrains 在 2026 年 5 月调整过 token scope 机制，旧 token 被批量作废过一次。如果 CI 报 `Authentication Failed: Marketplace service scope is missing`，重新生成一个 scope 为 Marketplace 的 token 即可。

## 5. 配置 GitHub Secrets

在 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

添加 4 个 secret（名字必须与下面完全一致，CI 直接按这些名字读）：

| Secret 名 | 内容 |
| --- | --- |
| `PUBLISH_TOKEN` | 第 4 步生成的 `perm:...` token |
| `CERTIFICATE_CHAIN` | `chain.crt` 的完整内容 |
| `PRIVATE_KEY` | `private_encrypted.pem` 的完整内容 |
| `PRIVATE_KEY_PASSWORD` | 生成私钥时设的密码 |

> `CERTIFICATE_CHAIN` 和 `PRIVATE_KEY` 是多行内容，直接把整个文件内容粘进 secret 输入框即可（含 `-----BEGIN ...-----` / `-----END ...-----` 行）。

## 6. CI 自动发布机制

`.github/workflows/release.yml` 里的 `build-jetbrains-plugin` job 在 release 时执行：

1. `actions/setup-java@v5`（temurin JDK 21）。
2. `actions/checkout` + `mise-action`。
3. 校验 `gradle.properties` 的 `pluginVersion` 与 release tag 一致。
4. **Build JetBrains plugin ZIP**：`mise run package:jetbrains`，注入签名 secret —— secret 齐全时产出签名 zip，缺失时 `signPlugin` 自动跳过、产出未签名 zip。
5. **Upload JetBrains plugin to release**：把 zip 传到 GitHub Release。
6. **Publish to JetBrains Marketplace**：注入 4 个 secret，shell 先 gate 检查 `PUBLISH_TOKEN`、`PRIVATE_KEY`、`CERTIFICATE_CHAIN` 是否齐全，齐全才跑 `./gradlew publishPlugin`，否则打印 `::notice::` 跳过。

发布步骤的 gate 逻辑：

```yaml
- name: Publish to JetBrains Marketplace
  env:
    PUBLISH_TOKEN: ${{ secrets.PUBLISH_TOKEN }}
    CERTIFICATE_CHAIN: ${{ secrets.CERTIFICATE_CHAIN }}
    PRIVATE_KEY: ${{ secrets.PRIVATE_KEY }}
    PRIVATE_KEY_PASSWORD: ${{ secrets.PRIVATE_KEY_PASSWORD }}
  run: |
    if [ -z "$PUBLISH_TOKEN" ] || [ -z "$PRIVATE_KEY" ] || [ -z "$CERTIFICATE_CHAIN" ]; then
      echo "::notice::Marketplace publish secrets not fully configured — skipping publish. GitHub Release upload completed."
      exit 0
    fi

    cd ide-plugins/jetbrains && ./gradlew publishPlugin
```

这个设计保证：在 secret 配齐之前（含完成首次手动上传之前），CI 不会因为缺 token 而失败，只会跳过 Marketplace 发布、照常把 zip 传到 GitHub Release。

## 7. 版本号同步

`release-please-config.json` 通过 `generic` updater 把版本同步到 `gradle.properties`：

```json
{
  "type": "generic",
  "path": "ide-plugins/jetbrains/gradle.properties"
}
```

配合 `gradle.properties` 里的行内注解：

```properties
pluginVersion=1.13.1 # x-release-please-version
```

release-please bump 版本时会自动更新这一行，无需手动改。`platformVersion` 那行没有注解，不会被误改。

## 8. Release Channel 如何分流

`build.gradle.kts` 的 `publishing.channels` 会根据版本号的 pre-release label 自动决定发布渠道：

```kotlin
publishing {
    token = providers.environmentVariable("PUBLISH_TOKEN")
    channels = providers.gradleProperty("pluginVersion")
        .map { listOf(it.substringAfter('-', "").substringBefore('.').ifEmpty { "default" }) }
}
```

分流规则：

| 版本号 | 发布渠道 | 用户可见性 |
| --- | --- | --- |
| `1.13.1` | `default` | 主渠道，所有人默认可见 |
| `1.14.0-alpha.1` | `alpha` | 自定义渠道，需手动添加该渠道才能装到 |
| `1.14.0-beta.2` | `beta` | 自定义渠道 |

本项目 `release-please-config.json` 配了 `"prerelease": true`，版本号会带 `-next.N` / `-alpha` 等后缀，因此预发布版本会进对应的自定义渠道，稳定版才进 `default`。这正是期望行为。

## 常见错误

### `No Marketplace ZIP Signer executable found`

IntelliJ Platform Gradle Plugin 2.x 不再自动下载 ZIP Signer，必须在 `dependencies.intellijPlatform` 里显式声明：

```kotlin
intellijPlatform {
    // ...
    zipSigner()
}
```

本仓库已包含这一行。如果删掉它，`signPlugin` 就会报这个错。

### `Authentication Failed: Marketplace service scope is missing`

token 的 scope 不对。重新到 `https://plugins.jetbrains.com/author/me/tokens` 生成一个 scope 为 **Marketplace** 的 token，更新 `PUBLISH_TOKEN` secret。

### `publishPlugin` 报插件不存在 / 找不到 plugin id

说明插件还没完成**首次手动上传**。`publishPlugin` 只能更新已存在的插件。先按第 3 节手动首传并过审。

### CI 跳过了 Marketplace 发布

日志里出现 `Marketplace publish secrets not fully configured — skipping publish`。检查 `PUBLISH_TOKEN`、`PRIVATE_KEY`、`CERTIFICATE_CHAIN` 三个 secret 是否都已配置。

### 用户安装时提示插件未签名

上传的是未签名 zip。确认签名 secret 已配置，且 CI 的 build step 注入了 `CERTIFICATE_CHAIN` / `PRIVATE_KEY` / `PRIVATE_KEY_PASSWORD`，或本地用 `mise run package:jetbrains:sign`（而非 `package:jetbrains`）出包。

### `verifyPluginSignature` 报错 / 打印 Usage 后失败

intellij-platform-gradle-plugin 2.16.0 的 `VerifyPluginSignatureTask` 有一个 bug：使用 `certificateChain`（字符串内容）时，证书内容会被当作多余的 CLI 位置参数传给 ZIP Signer，导致 CLI 打印 Usage 并失败。

本仓库已在 `build.gradle.kts` 里配置 `verifyPluginSignature` 改用 `certificateChainFile`（文件路径）绕过此 bug，并由 mise task 注入 `CERTIFICATE_CHAIN_FILE` 环境变量 + `--no-configuration-cache` 标志。

如果你直接跑 `./gradlew verifyPluginSignature`（不经过 mise task），需要：

```bash
export CERTIFICATE_CHAIN_FILE=/absolute/path/to/chain.crt
./gradlew verifyPluginSignature --no-configuration-cache
```

## 收尾 checklist

首次配置完成后逐项确认：

1. [ ] 签名密钥对已生成，私钥 + 密码已离线保存（不只在 GitHub Secret 里）。
2. [ ] 用签名 zip 完成 Marketplace 首次手动上传，且已过审上架。
3. [ ] `PUBLISH_TOKEN`（scope = Marketplace）已生成。
4. [ ] 4 个 GitHub Secret 全部配置：`PUBLISH_TOKEN`、`CERTIFICATE_CHAIN`、`PRIVATE_KEY`、`PRIVATE_KEY_PASSWORD`。
5. [ ] 触发一次 release，确认 zip 上传到 GitHub Release，且 `publishPlugin` 成功发布到 Marketplace。
6. [ ] 后续每次 release 由 CI 自动签名 + 发布（仍需等待 JetBrains 审核）。

## 参考

- [Publishing a Plugin | IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/publishing-plugin.html)
- [Plugin Signing | IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html)
- [Uploading a new plugin | JetBrains Marketplace](https://plugins.jetbrains.com/docs/marketplace/uploading-a-new-plugin.html)
- [IntelliJ Platform Gradle Plugin (2.x)](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html)
- VS Code 发布流程见同目录 [`vscode-marketplace-oidc-publish.md`](./vscode-marketplace-oidc-publish.md)