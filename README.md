# PiKVM Control Room

Aplicativo desktop de código aberto para Windows que reúne vários PiKVMs em janelas por monitor, com abas, divisões e uma central de controles.

## Recursos

- Janelas independentes por monitor, layouts de 1, 2 ou 4 áreas e abas por janela.
- Vídeo WebRTC/H.264, H.264 direto e MJPEG, com reconexão automática.
- Controle de teclado e mouse ao entrar no quadrante. F10 libera o controle; F11 alterna a tela cheia.
- Tela cheia com barra retrátil no topo para acessar abas, monitores e a central.
- Áudio e microfone independentes do foco e das abas, com identificação visual da origem do som.
- Ctrl+Shift+M para mutar ou desmutar todos os microfones sem interromper os streams.
- Legendas locais por conexão, medidores separados e registro de reuniões em WAV, TXT e SRT.
- Controles ATX, mídia virtual, GPIO e PiKVM Switch, quando disponíveis no equipamento.

O aplicativo integra diretamente a API do PiKVM e não incorpora uma página de controle completa em cada área.

## Requisitos

- Windows x64.
- PiKVM acessível pela rede e credenciais de acesso.
- Suporte WebRTC/Janus, áudio e microfone no equipamento para usar essas funções.
- Placa NVIDIA compatível com CUDA para aceleração opcional da transcrição; há opção de processamento por CPU.

## Executar a partir do código

Instale Node.js 22 ou posterior e execute:

```powershell
npm ci
npm start
```

No primeiro início, o workspace está vazio. Clique em **+** na lista de equipamentos para cadastrar o endereço, o usuário e a senha do seu PiKVM. Endereços terminados em `/kvm/` são normalizados automaticamente.

## Gerar o executável portátil

```powershell
npm run build
```

O executável é criado em `dist/` e não exige Node.js no computador de destino. A compilação não inclui assinatura comercial. Preferências de instalações anteriores são preservadas na pasta de dados do usuário.

## Operação

1. Cadastre os equipamentos e atribua cada um a uma área usando o botão de ajustes do quadrante.
2. Selecione a divisão de 1, 2 ou 4 áreas. O botão de ampliar mostra somente a área escolhida e permite voltar à divisão.
3. Use **Nova aba** para organizar outros grupos de equipamentos.
4. Em **Monitores**, abra outra janela ou mova a janela atual para outro monitor.
5. A central atua sobre o equipamento selecionado. **Central separada** acompanha a seleção das janelas de vídeo.
6. Entre com o mouse no vídeo para controlar. Ao sair, teclas e botões são liberados. Após F10, saia e entre novamente ou clique para retomar.
7. Em tela cheia, aproxime o mouse do topo para acessar a barra retrátil. F10 libera o controle e revela a barra; F11 sai da tela cheia.

O áudio continua nas abas de fundo. Uma sessão por equipamento evita reprodução duplicada quando o mesmo PiKVM aparece em mais de uma área. A borda âmbar indica atividade sonora. O microfone pode ser mutado individualmente na central ou em conjunto com Ctrl+Shift+M.

Novos equipamentos atribuídos ao workspace podem usar o microfone padrão conforme as preferências salvas. Verifique os indicadores MIC e MIC MUDO para acompanhar o envio de voz. A captura do microfone permanece conectada durante o mute, mas transmite silêncio.

## Legendas e reuniões

Em **Central → Legendas**, escolha o processamento por NVIDIA/CUDA ou CPU, o pacote de reconhecimento e o idioma. Clique em **Instalar / carregar motor local**. O download é necessário uma vez; depois, a transcrição funciona offline e não envia áudio a serviços externos.

- **Legendas ao vivo neste PiKVM** exibe o texto no quadrante e na central, inclusive em tela cheia. Sem gravação de reunião, o áudio não é salvo em disco.
- **Gravar reunião** inicia um registro separado por conexão, identificado pelo indicador GRAVANDO.
- **Encerrar reunião** confirma o último bloco de áudio e finaliza os arquivos. Aguarde o processamento das últimas legendas antes de fechar.
- **Registros salvos → Abrir pasta** permite consultar os arquivos.
- **Revisar transcrição** processa novamente o áudio salvo com o pacote selecionado e preserva os textos originais. Encerre as reuniões e aguarde a fila antes de revisar.

Cada registro pode conter:

| Arquivo | Conteúdo |
| --- | --- |
| `received.wav` | Áudio recebido do PiKVM |
| `sent.wav` | Microfone enviado ao PiKVM; silêncio durante o mute |
| `transcript.txt` | Texto com horários relativos ao início da reunião |
| `transcript.srt` | Legendas com marcação de tempo |
| `segments.jsonl` | Segmentos de texto e identificação do sentido |
| `meeting.json` | Identificação e estado da reunião |
| `reviewed.txt` / `reviewed.srt` | Revisão posterior, quando solicitada |

A gravação acompanha a conexão mesmo ao trocar de aba ou desatribuir a área. O áudio remoto é capturado antes do ajuste de volume da reprodução local. A gravação não começa automaticamente.

As legendas chegam em blocos de aproximadamente 2–6 segundos, mais o processamento. Há identificação do sentido do áudio, mas não dos participantes individuais. Ruído, falas sobrepostas, nomes próprios e cortes de frase podem causar erros. Se a fila atrasar, o áudio da reunião continua salvo para revisão posterior. Registros interrompidos podem ser recuperados a partir do áudio já salvo.

A instalação com CUDA exige aproximadamente 640 MB de download, além do pacote de reconhecimento e dos arquivos descompactados. Dois sentidos de áudio PCM mono de 16 kHz/16 bits consomem aproximadamente 230 MB por hora de reunião.

## Dados locais

As preferências e credenciais ficam na pasta de dados do usuário, normalmente `%APPDATA%/pikvm-control-room/`. Senhas cadastradas são protegidas pelo armazenamento seguro do Windows e ficam no processo principal. Gravações e recursos de transcrição ficam na subpasta `local-asr/`.

Os serviços de apoio HTTP/WebSocket escutam somente em `127.0.0.1`, em portas aleatórias e com identificador aleatório por execução. A permissão de microfone é restrita à janela local de áudio. Certificados autoassinados podem ser permitidos individualmente ao cadastrar um equipamento; essa opção não desativa a validação TLS globalmente.

Não publique `config.json`, a pasta de dados, gravações ou credenciais. Esses arquivos não fazem parte do repositório.

## Testes

```powershell
npm test
npm run test:ui
```

Os testes padrão usam servidores simulados e perfis temporários. Cobrem protocolo HID, geometria do mouse, autenticação, layouts, abas, tela cheia, mute, gravação e exportação de texto/legendas.

Para testes com um equipamento real de desenvolvimento, usando as credenciais padrão de fábrica:

```powershell
$env:PIKVM_URL = 'https://pikvm.exemplo.local'
node tests/smoke.cjs --live
node tests/smoke.cjs --live --mic --grid
```

A opção `--mic` envia um sinal sintético de microfone. `--live-hid` envia Caps Lock e restaura o estado original. Os testes não executam comandos de energia, GPIO ou escrita de mídia no equipamento real.

Para testar as legendas, instale o processamento CUDA com o pacote Base e disponibilize uma fala de teste em `artifacts/speech-pt.wav`, mono PCM de 16 kHz. Execute `npm run test:captions`. A opção `--packaged` usa o executável de `dist/win-unpacked`.

Capturas de verificação ficam em `artifacts/` e compilações em `dist/`, fora do controle de versão. `PIKVM_DATA_DIR` permite isolar a pasta de dados nos testes.

## Limitações

- A disponibilidade das funções depende do hardware e da configuração do PiKVM.
- Atalhos reservados pelo Windows podem precisar dos botões da central.
- Não há identificação automática de participantes individuais nas reuniões.
- Múltiplos monitores físicos e reuniões reais precisam ser validados no ambiente de uso.
- O projeto é independente e não representa uma distribuição oficial do PiKVM.

## Contribuir e licença

Consulte [CONTRIBUTING.md](CONTRIBUTING.md). O código do aplicativo é distribuído sob a [licença MIT](LICENSE). Dependências e componentes baixados separadamente mantêm suas próprias licenças.

Documentação de integração: [API do PiKVM](https://docs.pikvm.org/api/), [vídeo](https://docs.pikvm.org/video/), [áudio](https://docs.pikvm.org/audio/) e [protocolo Janus](https://janus.conf.meetecho.com/docs/rest.html).
