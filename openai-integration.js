// OpenAI Integration Template
// NOTE: Replace with your actual API key and implement server-side for security

class OpenAIAgent {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
        this.conversationHistory = [];
        this.maxTokens = 150;
        this.temperature = 0.7;
    }

    async sendMessage(userMessage) {
        try {
            // Add user message to conversation history
            this.conversationHistory.push({
                role: 'user',
                content: userMessage
            });

            // Prepare the request
            const requestBody = {
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un agent IA spécialisé en innovation et design thinking. 
                        Ton rôle est d'accompagner les étudiants dans leur projet d'innovation en utilisant 
                        des méthodes comme SCAMPER, le prototypage rapide, et l'analyse business model.
                        Sois encourageant, constructif et propose des actions concrètes.
                        Réponds en français de manière claire et professionnelle.`
                    },
                    ...this.conversationHistory.slice(-10) // Keep last 10 messages for context
                ],
                max_tokens: this.maxTokens,
                temperature: this.temperature
            };

            // Make the API call
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const aiResponse = data.choices[0].message.content;

            // Add AI response to conversation history
            this.conversationHistory.push({
                role: 'assistant',
                content: aiResponse
            });

            return aiResponse;

        } catch (error) {
            console.error('OpenAI API Error:', error);
            return "Désolé, je rencontre des difficultés techniques. Pouvez-vous reformuler votre question ?";
        }
    }

    // Method to reset conversation
    resetConversation() {
        this.conversationHistory = [];
    }

    // Method to get conversation summary
    getConversationSummary() {
        return this.conversationHistory.length;
    }
}

// IMPORTANT SECURITY NOTE:
// Pour une utilisation en production, NE JAMAIS exposer votre clé API côté client!
// Implémentez plutôt un serveur backend qui agira comme proxy:

/*
// Exemple d'implémentation sécurisée avec Node.js/Express:
// server.js
const express = require('express');
const { OpenAI } = require('openai');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
    apiKey: 'votre-clé-api-ici' // Stockée dans les variables d'environnement
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, conversationHistory } = req.body;
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'Tu es un agent IA spécialisé en innovation...'
                },
                ...conversationHistory,
                { role: 'user', content: message }
            ],
            max_tokens: 150,
            temperature: 0.7
        });

        res.json({
            response: completion.choices[0].message.content
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
*/

// Client-side implementation with backend proxy:
class SecureOpenAIAgent {
    constructor() {
        this.apiUrl = '/api/chat'; // Your backend endpoint
        this.conversationHistory = [];
    }

    async sendMessage(userMessage) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: userMessage,
                    conversationHistory: this.conversationHistory
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const aiResponse = data.response;

            // Update conversation history
            this.conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content: aiResponse }
            );

            return aiResponse;

        } catch (error) {
            console.error('API Error:', error);
            return "Désolé, je rencontre des difficultés techniques. Pouvez-vous reformuler votre question ?";
        }
    }
}

// Usage example (replace the existing ChatAgent in script.js):
/*
document.addEventListener('DOMContentLoaded', function() {
    // WARNING: This is insecure for production!
    const agent = new OpenAIAgent('sk-proj-votre-clé-api-ici');
    
    // Or use secure backend version:
    // const agent = new SecureOpenAIAgent();
    
    // Rest of your chat implementation...
});
*/
