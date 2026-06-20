# 使用 GitHub OIDC 发布 VS Code 扩展到 Marketplace

这篇笔记记录如何使用 Microsoft Entra ID / Azure 身份，通过 GitHub Actions 安全发布 VS Code `.vsix` 扩展到 Visual Studio Marketplace，避免使用长期 Personal Access Token（PAT）。

## 目标

发布流程完成后，GitHub Actions 可以在 release 时自动执行：

```bash
npx @vscode/vsce publish --azure-credential --packagePath <extension.vsix>
```

认证方式为：

```text
GitHub Actions OIDC token
  -> Azure login
  -> Microsoft Entra access token
  -> VS Code Marketplace / Azure DevOps Marketplace API
```

## 需要准备的信息

本项目当前使用的 Azure 身份信息：

```text
AZURE_SUBSCRIPTION_ID = a5bd106f-4846-4fba-a27c-beef0f2fae8e
AZURE_CLIENT_ID       = 6a5f3fb7-e0ec-4647-b058-0873fc60fa78
AZURE_TENANT_ID       = 960cd5b2-883d-4387-8be8-1120950d82e9
```

这些值不是发布密钥，但仍建议只放在 GitHub Secrets / Variables 中管理。

不要把 client secret、PAT、access token 贴到公开位置。

## 总体流程

1. 创建 VS Code Marketplace publisher。
2. 创建 Azure 身份：User-assigned Managed Identity 或 App Registration / Service Principal。
3. 给 Azure 身份配置 GitHub OIDC federated credential。
4. 把 Azure 身份信息写入 GitHub Actions Secrets。
5. 运行临时 workflow，查询这个身份在 Marketplace / Azure DevOps 里的 identity id。
6. 在 Marketplace publisher 成员里添加这个 identity id，并赋予 `Contributor` 角色。
7. 在 release workflow 中使用 `azure/login` 和 `vsce --azure-credential` 发布 `.vsix`。
8. 验证发布权限，删除临时查询 workflow。

## 1. 创建 VS Code Marketplace Publisher

打开：

```text
https://marketplace.visualstudio.com/manage
```

创建一个 Publisher。注意：

- Publisher ID 是扩展清单里的 `publisher` 字段。
- Publisher ID 不是展示名，不能随便填带空格的人类可读名称。
- 创建后需要把 `ide-plugins/vscode/package.json` 里的字段改成实际 Publisher ID：

```json
{
  "publisher": "<your-publisher-id>"
}
```

当前项目里原值是：

```json
"publisher": "local"
```

发布前必须改掉。

## 2. 创建 Azure 身份

推荐使用 User-assigned Managed Identity，也可以使用 App Registration / Service Principal。

### 方案 A：User-assigned Managed Identity

Azure Portal：

1. 打开 **Managed Identities**。
2. 点击 **Create**。
3. 选择 **User-assigned**。
4. 创建后记录：
   - Client ID
   - Tenant ID
   - Subscription ID

通常还需要给它最小 Azure 权限，例如在 Subscription 或 Resource Group 上授予 `Reader`。

### 方案 B：App Registration / Service Principal

Azure Portal：

1. Microsoft Entra ID -> **App registrations**。
2. 创建应用。
3. 记录 Application / Client ID、Tenant ID。
4. 如需本地调试，可以临时创建 client secret。
5. 调试结束后建议删除临时 client secret。

## 3. 配置 GitHub OIDC Federated Credential

进入对应的 Managed Identity 或 App Registration，添加 federated credential。

如果绑定 main 分支：

```text
repo:balaenis/pi-x-ide:ref:refs/heads/main
```

配置项大致为：

```text
Organization: balaenis
Repository: pi-x-ide
Entity type: Branch
Branch: main
Audience: api://AzureADTokenExchange
```

这表示只有 `balaenis/pi-x-ide` 的 `main` 分支 workflow 可以通过 OIDC 换取这个 Azure 身份的 token。

## 4. 配置 GitHub Secrets

在 GitHub repo：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

添加：

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
```

示例值：

```text
AZURE_CLIENT_ID       = 6a5f3fb7-e0ec-4647-b058-0873fc60fa78
AZURE_TENANT_ID       = 960cd5b2-883d-4387-8be8-1120950d82e9
AZURE_SUBSCRIPTION_ID = a5bd106f-4846-4fba-a27c-beef0f2fae8e
```

## 5. 临时查询 Marketplace Identity ID

Marketplace 不直接使用 `AZURE_CLIENT_ID` 作为成员 ID。它需要这个身份在 Azure DevOps / Marketplace 里的 identity id。

项目里已经添加了临时 workflow：

```text
.github/workflows/marketplace-identity.yml
```

内容核心是：

```yaml
name: Show Marketplace Identity

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  show-identity:
    runs-on: ubuntu-latest
    steps:
      - name: Azure login
        uses: azure/login@v3
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Show Marketplace identity
        run: |
          az rest \
            -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
            --resource 499b84ac-1321-427f-aa17-267ca6975798 \
            --query "{id:id, displayName:displayName, publicAlias:publicAlias}" \
            -o json
```

运行方式：

```text
GitHub -> Actions -> Show Marketplace Identity -> Run workflow
```

输出类似：

```json
{
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "displayName": "...",
  "publicAlias": "..."
}
```

这里的 `id` 才是后续要加到 Marketplace publisher 成员里的 ID。

### 这个 workflow 要一直保留吗？

不建议长期保留。

推荐流程：

1. 手动运行一次。
2. 复制输出里的 `id`。
3. 完成 Marketplace 成员授权。
4. 删除 `.github/workflows/marketplace-identity.yml`。

这个 `id` 本身不是密码，但查询入口没有长期保留的必要。

## 6. 在 Marketplace Publisher 中添加身份

打开：

```text
https://marketplace.visualstudio.com/manage
```

进入对应 Publisher：

1. 打开 **Members** / **Access** / **Permissions**。
2. 点击 **Add**。
3. 粘贴上一步输出的 `id`。
4. 角色选择 `Contributor`。

可以先用 `Reader` 测试是否能识别该身份，再改为 `Contributor`。

角色说明：

- `Reader`：只能验证读取权限。
- `Contributor`：可以发布和更新扩展。
- `Owner`：可以管理 Publisher 成员，通常不应给 CI 身份。

## 7. Release Workflow 发布配置

`.github/workflows/release.yml` 需要包含 OIDC 权限：

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

发布步骤：

```yaml
- name: Azure login
  uses: azure/login@v3
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Publish to VS Code Marketplace
  run: |
    VSIX_FILE=$(ls ide-plugins/vscode/dist/*.vsix | head -1)
    echo "Publishing $VSIX_FILE to VS Code Marketplace..."
    npx @vscode/vsce publish --azure-credential --packagePath "$VSIX_FILE"
```

## 8. 验证 Marketplace 权限

可以临时加一步验证：

```yaml
- name: Verify Marketplace access
  run: npx @vscode/vsce verify-pat <publisher-id> --azure-credential
```

虽然命令名叫 `verify-pat`，但加了 `--azure-credential` 后使用的是 Microsoft Entra token，不是长期 PAT。

如果成功，会输出类似：

```text
The Personal Access Token verification succeeded for the publisher '<publisher-id>'.
```

## 9. 本地或 Azure Cloud Shell 查询身份

如果当前环境能成功登录目标 identity，也可以手动查询：

```bash
az login --identity --client-id 6a5f3fb7-e0ec-4647-b058-0873fc60fa78
```

然后运行：

```bash
az rest \
  -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
  --resource 499b84ac-1321-427f-aa17-267ca6975798 \
  --query "{id:id, displayName:displayName, publicAlias:publicAlias}" \
  -o json
```

注意：如果这是 User-assigned Managed Identity，本地机器通常不能直接 impersonate 它；Azure Cloud Shell 或某些 Azure 资源环境可能可以。

如果要确认 token 是否来自目标 client id，可以解码 access token：

```bash
TOKEN="$(az account get-access-token \
  --resource 499b84ac-1321-427f-aa17-267ca6975798 \
  --query accessToken -o tsv)"

python3 - "$TOKEN" <<'PY'
import sys, json, base64
payload = sys.argv[1].split(".")[1]
payload += "=" * ((4 - len(payload) % 4) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
for k in ["appid", "azp", "oid", "idtyp", "xms_mirid", "upn", "preferred_username", "sub"]:
    print(f"{k}: {claims.get(k)}")
PY
```

重点检查 `appid` 或 `azp` 是否等于：

```text
6a5f3fb7-e0ec-4647-b058-0873fc60fa78
```

如果不匹配，不要把这个 `profiles/me.id` 加到 Marketplace，因为它不是 GitHub Actions 发布时会使用的身份。

## 10. `--resource` 参数是什么意思

命令中的：

```bash
--resource 499b84ac-1321-427f-aa17-267ca6975798
```

不是 Azure Resource Group 或 Subscription 里的资源。

它表示要向 Microsoft Entra ID 申请哪个服务的 access token。

这个 GUID 是 Azure DevOps / Visual Studio Marketplace 相关服务的资源 ID。也就是说：

```text
申请一个可以调用 Azure DevOps / Marketplace API 的 token
```

如果访问普通 Azure Resource Manager API，常见 resource 是：

```text
https://management.azure.com/
```

但这里访问的是：

```text
https://app.vssps.visualstudio.com/
https://marketplace.visualstudio.com/
```

所以需要指定 Azure DevOps / Marketplace 的 resource。

## 11. 如果 `--azure-credential` 发布失败

`vsce --azure-credential` 使用 Azure SDK 的 `DefaultAzureCredential`。在某些环境中，它可能选错 credential source。

可以改用短期 Entra access token 作为 workaround：

```yaml
- name: Publish to VS Code Marketplace
  run: |
    VSCE_TOKEN="$(az account get-access-token \
      --resource 499b84ac-1321-427f-aa17-267ca6975798 \
      --query accessToken -o tsv)"

    VSIX_FILE=$(ls ide-plugins/vscode/dist/*.vsix | head -1)
    npx @vscode/vsce publish --pat "$VSCE_TOKEN" --packagePath "$VSIX_FILE"
```

这里 `--pat` 参数传的是短期 Entra access token，不是长期 Personal Access Token。

## 12. 常见错误

### `403` 或 `The requested operation is not allowed`

通常表示当前身份没有 Marketplace publisher 权限。

检查：

1. GitHub OIDC 是否绑定了正确 repo / branch。
2. `azure/login` 是否使用了正确 `AZURE_CLIENT_ID`。
3. `profiles/me` 返回的 `id` 是否已加入 Publisher Members。
4. 角色是否为 `Contributor`。
5. `ide-plugins/vscode/package.json` 里的 `publisher` 是否等于 Marketplace Publisher ID。

### `Invalid publisher name`

通常是 `publisher` 填了展示名，而不是 Publisher ID。

错误示例：

```json
"publisher": "My Publisher Name"
```

正确示例：

```json
"publisher": "my-publisher-id"
```

### `publisher` 仍然是 `local`

发布前必须修改：

```json
"publisher": "local"
```

改为实际 Publisher ID。

### 查询到的 identity id 不匹配目标 client id

不要使用这个 identity id 授权 Marketplace。

应该：

1. 用 GitHub Actions 临时 workflow 查询。
2. 或在真正挂载该 Managed Identity 的 Azure 资源中查询。
3. 或对 App Registration 使用临时 client secret 登录后查询。

## 13. 推荐收尾动作

完成首次配置后：

1. 删除临时 workflow：

```text
.github/workflows/marketplace-identity.yml
```

2. 保留 release workflow 中的正式发布步骤。
3. 确认 `ide-plugins/vscode/package.json` 的 `publisher` 字段已改成真实 Publisher ID。
4. 用 `vsce verify-pat <publisher-id> --azure-credential` 验证权限。
5. 触发一次 release，确认 `.vsix` 上传到 GitHub Release，并发布到 VS Code Marketplace。
