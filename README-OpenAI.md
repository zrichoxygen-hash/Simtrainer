# Intégration OpenAI - Guide d'Installation

## 🔐 Avertissement de Sécurité Important

**NE JAMAIS exposer votre clé API OpenAI côté client en production!**
Cela pourrait entraîner des coûts élevés et des abus malveillants.

## ✅ Implémentation Actuelle (Option 2 Sécurisée)

Le projet est maintenant configuré en mode sécurisé:
- Le frontend ([script.js](script.js)) appelle uniquement `POST /api/chat`.
- La clé API OpenAI est lue côté serveur via `.env`.
- Le serveur est dans [server.js](server.js) et sert aussi les fichiers statiques.

### Démarrage

1. Créez votre fichier `.env` à partir de `.env.example`.
2. Renseignez `OPENAI_API_KEY` et `WORKFLOW_ID`.
3. Lancez:

```bash
npm start
```

4. Ouvrez `http://localhost:3000`.

## 📋 Options d'implémentation

### Option 1: Test/Développement (Non sécurisé pour production)

1. **Remplacez le ChatAgent existant** dans `script.js`:

```javascript
// Remplacez la classe ChatAgent par:
class ChatAgent {
    constructor() {
        this.openaiAgent = new OpenAIAgent('votre-clé-api-ici');
        this.conversationHistory = [];
    }

    async sendMessage(message) {
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            const response = await this.openaiAgent.sendMessage(message);
            this.hideTypingIndicator();
            this.addMessageToChat('AGENT IA', response, 'ai');
            this.updateEvaluationMetrics();
        } catch (error) {
            this.hideTypingIndicator();
            this.addMessageToChat('AGENT IA', 'Désolé, une erreur est survenue.', 'ai');
        }
    }
    
    // ... autres méthodes existantes
}
```

### Option 2: Production (Recommandé - Sécurisé)

1. **Créez un serveur backend** (Node.js/Express):

```bash
npm init -y
npm install express openai cors
```

2. **Créez `server.js`:** (voir le code dans `openai-integration.js`)

3. **Démarrez le serveur:**

```bash
node server.js
```

4. **Utilisez la version sécurisée côté client:**

```javascript
const agent = new SecureOpenAIAgent();
```

## 🔧 Configuration

### Variables d'environnement (Production)

Créez un fichier `.env`:
```
OPENAI_API_KEY=sk-proj-votre-clé-ici
PORT=3000
```

### Installation des dépendances

```bash
# Pour le serveur backend
npm install express openai cors dotenv

# Pour le développement frontend
npm install --save-dev http-server
```

## 🚀 Démarrage rapide

### Test rapide avec clé API (Développement uniquement)

1. Ouvrez `script.js`
2. Remplacez la ligne:
```javascript
const agent = new ChatAgent();
```
par:
```javascript
const agent = new OpenAIAgent('sk-proj-votre-clé-api-ici');
```

### Production avec backend

1. Lancez le serveur: `node server.js`
2. Mettez à jour `script.js` pour utiliser `SecureOpenAIAgent`
3. Testez l'application

## 📊 Personnalisation du modèle

### Paramètres ajustables:

```javascript
const requestBody = {
    model: 'gpt-3.5-turbo',  // ou 'gpt-4'
    max_tokens: 150,         // Longueur de réponse
    temperature: 0.7,        // Créativité (0-1)
    // ...
};
```

### Prompt système personnalisé:

```javascript
{
    role: 'system',
    content: `Tu es un expert en innovation et design thinking...
    Spécialise-toi sur: [votre domaine]
    Ton ton: [professionnel/amical/technique]
    ...`
}
```

## 🛡️ Bonnes pratiques de sécurité

1. **Toujours utiliser un backend** pour les appels API
2. **Limiter les tokens** pour contrôler les coûts
3. **Ajouter une authentification** utilisateur
4. **Surveiller l'utilisation** API
5. **Implémenter des rate limits**

## 📈 Monitoring et coûts

- Surveillez votre usage sur [platform.openai.com](https://platform.openai.com)
- Définissez des limites de dépenses dans les paramètres OpenAI
- Implémentez des logs côté serveur

## 🔗 Ressources utiles

- [Documentation OpenAI](https://platform.openai.com/docs)
- [Pricing OpenAI](https://openai.com/pricing)
- [Best practices](https://platform.openai.com/docs/guides/prompt-engineering)

## 🆘 Support

En cas d'erreur:
1. Vérifiez votre clé API
2. Consultez les logs du serveur
3. Testez avec curl/Postman
4. Vérifiez les quotas OpenAI

---

**⚠️ Rappelez-vous: La sécurité avant tout!**
