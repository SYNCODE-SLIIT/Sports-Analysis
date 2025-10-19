<!-- 71299fe2-298d-4a69-89f5-3a5c2b6a19ec 6689ef30-c462-4077-99a4-3429373ed6a7 -->
# Chatbot Improvement Plan

## Backend Improvements

### 1. **Error Handling & Resilience**

- Add retry logic with exponential backoff for Tavily and Groq API calls
- Implement circuit breaker pattern to prevent cascading failures
- Add request timeout configuration per API endpoint
- Add structured logging with correlation IDs for better debugging
- Gracefully handle partial failures (e.g., some searches fail but others succeed)

**Files**: `sports-ai/backend/app/services/chatbot.py`

### 2. **Caching Layer**

- Cache Tavily search results (Redis or in-memory) with TTL (e.g., 5-15 minutes)
- Cache planner responses for similar questions using semantic similarity
- Add cache hit/miss metrics to response meta

**Files**: `sports-ai/backend/app/services/chatbot.py`, new cache module

### 3. **Rate Limiting & Quota Management**

- Implement per-user rate limiting to prevent abuse
- Track API quota usage (Groq, Tavily) and provide warnings
- Add graceful degradation when approaching quota limits

**Files**: `sports-ai/backend/app/routers/chatbot.py`, middleware

### 4. **Performance Optimizations**

- Execute Tavily searches in parallel instead of sequentially
- Stream responses for better perceived performance
- Add response compression
- Optimize planner/writer prompts to reduce token usage

**Files**: `sports-ai/backend/app/services/chatbot.py`

### 5. **Enhanced Context & Memory**

- Implement conversation summarization for long histories
- Add semantic search over past conversations
- Support conversation branching and forking
- Add context window management for different model sizes

**Files**: `sports-ai/backend/app/services/chatbot.py`

### 6. **Testing & Quality**

- Add comprehensive unit tests for chatbot service
- Add integration tests with mocked API responses
- Add performance/load testing
- Test edge cases (empty responses, malformed JSON, timeout scenarios)

**Files**: New `sports-ai/backend/app/tests/test_chatbot_service.py`

### 7. **Monitoring & Observability**

- Add metrics (response time, token usage, cache hit rate, error rate)
- Structured logging with request/response payloads
- Add health check endpoint for chatbot service dependencies

**Files**: `sports-ai/backend/app/routers/chatbot.py`, logging utilities

## Frontend Improvements

### 8. **UX Enhancements**

- Add typing indicators with realistic delays
- Show search progress (e.g., "Searching Premier League results...")
- Add suggested prompts/questions for new users
- Add message reactions (thumbs up/down for feedback)
- Support editing previous messages
- Add "regenerate response" button
- Show token usage/cost if applicable

**Files**: `web/src/components/chatbot/ChatbotPanel.tsx`

### 9. **Citation & Source Display**

- Add preview cards for citations (hover/click)
- Show source reliability scores if available
- Add inline citations within message text [1]
- Allow filtering/sorting citations
- Add "view all sources" expandable section

**Files**: `web/src/components/chatbot/ChatbotPanel.tsx`, new citation components

### 10. **Conversation Management**

- Add conversation history sidebar
- Support multiple conversation threads
- Add export conversation (JSON, Markdown, PDF)
- Add search within conversation
- Add conversation sharing functionality

**Files**: New conversation management components

### 11. **Accessibility & Mobile**

- Improve keyboard navigation
- Add ARIA labels and screen reader support
- Optimize mobile layout (full-screen on small devices)
- Add dark mode optimizations
- Add text-to-speech for responses

**Files**: `web/src/components/chatbot/ChatbotPanel.tsx`, `FloatingChatbot.tsx`

### 12. **Performance & Caching**

- Add optimistic UI updates
- Implement message streaming (SSE or WebSocket)
- Cache responses client-side
- Add service worker for offline support
- Debounce/throttle input to reduce unnecessary requests

**Files**: `web/src/components/chatbot/ChatbotPanel.tsx`, API routes

### 13. **Rich Media Support**

- Support images in responses (charts, player photos)
- Add embedded video highlights
- Support tables for statistics
- Add interactive components (polls, quizzes)

**Files**: `web/src/components/chatbot/MarkdownMessage.tsx`, new components

### 14. **User Preferences & Settings**

- Add chatbot settings panel (depth, response style, language)
- Save user preferences to localStorage/database
- Add conversation themes/personalities
- Add citation format preferences

**Files**: New settings component, preference hooks

### 15. **Error Handling & Feedback**

- Better error messages with actionable suggestions
- Add retry button for failed requests
- Show network status indicator
- Add offline mode with cached responses

**Files**: `web/src/components/chatbot/ChatbotPanel.tsx`

## Integration Improvements

### 16. **Sports-Specific Features**

- Add intent detection (match query, player stats, team info)
- Integrate with existing match analysis endpoints
- Add quick actions (e.g., "Show live matches", "My team's next game")
- Support follow-up questions with context retention
- Add sports entity recognition and linking

**Files**: Backend service, frontend quick actions

### 17. **Analytics & Feedback**

- Track question types and popular topics
- Collect user feedback (helpful/not helpful)
- A/B test different prompts and models
- Track conversation completion rates

**Files**: Analytics service, database tables

### 18. **API & Configuration**

- Support multiple LLM providers (fallback options)
- Add model selection (fast vs. accurate)
- Make temperatures and parameters configurable via UI
- Add API versioning

**Files**: Backend service configuration, admin settings

## Quick Wins (High Impact, Low Effort)

1. Add message timestamps
2. Add copy-to-clipboard button for messages
3. Implement Enter to send, Shift+Enter for new line (already exists but could be clearer)
4. Add loading skeleton for better perceived performance
5. Add empty state with example questions
6. Add keyboard shortcuts (e.g., Cmd+K to focus input)

### To-dos

- [ ] Add retry logic, circuit breaker, and improved error handling to backend service
- [ ] Implement caching layer for search results and planner responses
- [ ] Execute Tavily searches in parallel for better performance
- [ ] Add comprehensive test suite for chatbot service
- [ ] Add typing indicators, suggested prompts, and message reactions
- [ ] Improve citation display with preview cards and inline references
- [ ] Implement response streaming for better perceived performance
- [ ] Improve keyboard navigation and screen reader support
- [ ] Add sports-specific intent detection and quick actions
- [ ] Add metrics, logging, and observability to chatbot system