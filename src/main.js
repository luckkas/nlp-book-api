import express from 'express'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import pkg from 'natural'
import {  body, validationResult } from 'express-validator'

const { TfIdf } = pkg

class BookService { 
    constructor(dbPath) {
        this.dbPath = dbPath
        this.tfidf = new TfIdf()
        this.documents = []
    }

    async initialize() {
        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        })
        await this.loadDocuments()
    }

    async loadDocuments() {
        const docs = await this.db.all('SELECT * FROM books')
        docs.forEach((doc, index) => {
            this.tfidf.addDocument(doc.content)
            this.documents[index] = doc
        })
    }

    async findRelevantContent(query, limit = 3) {
        const keywords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2); // Basic tokenization
        const scores = [];
    
        this.documents.forEach((doc, index) => {
            let score = 0;
    

            // Count occurrences of keywords in title, chapter, and content
            keywords.forEach(keyword => {
                score += (doc.chapter.toLowerCase().includes(keyword) ? 2 : 0); // Medium weight for chapter matches
                score += (doc.content.toLowerCase().split(keyword).length - 1); // Count keyword occurrences in content
            });
    
            scores.push({ index, score });
        });
    
        // Sort and return top matches
        return scores
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(item => this.documents[item.index]);
    }
    
}


const app = express()
const bookService = new BookService('./main.db')

//Middleware
app.use(express.json())
app.use(cors())
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
}))

app.post('/api/ask', 
    body('question').isString().trim().isLength({ min: 3}),
    async (req, res) => {
        try {
            const errors = validationResult(req)
            if(!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() })
            }

            const { question } = req.body
            const relevantContent = await bookService.findRelevantContent(question)

            const answer = {
                question,
                sources: relevantContent.map(doc => ({
                    book: doc.name,
                    chapter: doc.chapter,
                    content: doc.content
                })),
                timestamp: new Date()
            }

            res.json(answer)
        } catch (error) {
            console.error('API ERROR: ', error)
            res.status(500).json({
                error: 'Internal Server Error',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        }
    }
)

app.use((err, req, res, next) => {
    console.error(err.stack)
    res.status(500).json({error: 'Something broke!'})
})

app.get('/heath', (req, res) => {
    res.json({ status: 'OK' })
})

const PORT = process.env.PORT || 3000
const startServer = async () => {
    await bookService.initialize()
    app.listen(PORT, () => console.log(`Server is running at ${PORT}`))
}

startServer()