# Contribuir

Abra uma issue descrevendo o problema ou a melhoria antes de mudanças extensas.
Para alterações pequenas, envie um pull request com o comportamento esperado e
os testes executados.

Use Node.js 22 ou posterior e Windows x64:

```powershell
npm ci
npm test
npm run test:ui
```

Não inclua senhas, configurações pessoais, gravações, endereços de equipamentos
em produção ou arquivos da pasta de dados do aplicativo. Utilize dados fictícios
nos testes. Mudanças na captura de áudio devem preservar o mute e as conexões
existentes. Comandos ATX, mídia e GPIO precisam manter suas confirmações.

As contribuições são distribuídas sob a licença MIT do projeto.
