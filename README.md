# Por Onde Andei

Um diário visual das viagens pelo Brasil. Projeto estático: HTML, CSS e JavaScript, sem conta, servidor de banco de dados ou dependências de mapas online.

Os limites dos estados e municípios estão incluídos em `assets/maps/` para o mapa funcionar sem uma API externa. Dados geográficos de [Brazil States](https://github.com/codeforamerica/click_that_hood) e [geodata-br](https://github.com/tbrugz/geodata-br).

## Abrir o projeto

Abra `index.html` com um servidor local, como a extensão Live Server do VS Code. Os mapas são arquivos GeoJSON locais em `assets/maps/`; alguns navegadores bloqueiam o carregamento desses arquivos quando a página é aberta diretamente como `file://`.

## Cadastrar e publicar viagens

1. Abra o projeto pelo Live Server em Chrome ou Edge. Clique em **Escolher pasta Mapas** e selecione a pasta `Mapas` que contém `index.html` e `assets/`; o botão **adicionar lembrança** também abre essa escolha automaticamente se a pasta ainda não estiver conectada. Permita a gravação quando o navegador pedir.
2. Preencha os dados e selecione até três fotos. Elas são redimensionadas e salvas em uma pasta com o nome da cidade, como `assets/photos/santana-do-acarau/`; o catálogo atualizado é salvo em `assets/data/visits.json`.
3. Em **Quem foi nessa viagem?**, escolha uma composição: Themystocles sozinho, Maryanna sozinha, Marya Eliza sozinha, o casal, pai e filha, mãe e filha ou os três juntos. A legenda sob o mapa identifica as cores; uma cidade visitada por composições diferentes aparece listrada e o hover mostra os grupos registrados.
4. Se quiser, cole o link de um álbum do Google Fotos ou de uma pasta do Drive, mesmo que tenha acesso restrito. Cada familiar precisa estar conectado a uma conta Google autorizada a acessar o álbum.
5. Confira a página e envie ao GitHub o commit que contém `assets/data/visits.json` e as novas imagens. O GitHub Pages publica os mesmos registros e fotos; não é preciso rodar um servidor para os visitantes.

O navegador pede autorização para editar os arquivos locais; reconecte a pasta se a permissão expirar. O salvamento direto usa a API de acesso a arquivos do Chrome e Edge e não funciona ao abrir o HTML como `file://`. Registros antigos que ainda existirem no armazenamento do navegador são migrados ao conectar a pasta.

No GitHub Pages, os controles de conectar, adicionar, editar e apagar não aparecem: o mapa e as visitas são somente leitura. A publicação é feita pelo Git, não pelo site.

Fotos dentro de `assets/photos/` ficam públicas com o repositório e o GitHub Pages. Um link de Drive não torna o álbum privado por si só: ajuste o acesso no próprio Drive e publique apenas fotos que você e sua família queiram compartilhar.