const express = require('express');
const { slimPlayers } = require('../helpers/slimPlayers');

const router = express.Router();

// Check if global fetch is available (Node 18+), otherwise use node-fetch
let fetch, AbortController;
try {
  fetch = globalThis.fetch;
  AbortController = globalThis.AbortController;
} catch (e) {
  // Fallback for older Node versions (though we prefer Node 18+)
  try {
    fetch = require('node-fetch');
    AbortController = require('abort-controller');
  } catch (importError) {
    console.error('[DRAFT] Warning: Neither global fetch nor node-fetch available');
  }
}

// Environment configuration
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1/chat-messages';
const DIFY_SECRET_KEY = process.env.DIFY_SECRET_KEY;
const MAX_INIT_PLAYERS = Number(process.env.MAX_INIT_PLAYERS || 50);
const LLM_BLOCKING_TIMEOUT_MS = Number(process.env.LLM_BLOCKING_TIMEOUT_MS || 3000000);

// POST /api/draft/initialize - Blocking endpoint to initialize draft strategy
router.post('/initialize', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { user, conversationId, payload } = req.body;

    // Validation
    if (!user) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: user'
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload object'
      });
    }

    const { numTeams, userPickPosition, players } = payload;

    if (typeof numTeams !== 'number') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.numTeams as number'
      });
    }

    if (typeof userPickPosition !== 'number') {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.userPickPosition as number'
      });
    }

    if (!Array.isArray(players)) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.players as array'
      });
    }

    if (players.length < 1) {
      return res.status(400).json({
        ok: false,
        message: 'Initialize requires: payload.players with at least 1 player'
      });
    }

    if (players.length > MAX_INIT_PLAYERS) {
      return res.status(400).json({
        ok: false,
        message: `Initialize requires: payload.players with at most ${MAX_INIT_PLAYERS} players`
      });
    }

    // Slim the players data
    const slimmedPlayers = slimPlayers(players);

    // Build Dify request payload
    const difyPayload = {
      user: user,
      response_mode: 'blocking',
      inputs: {
        numTeams: Number(numTeams),
        userPickPosition: Number(userPickPosition),
        players: slimmedPlayers
      },
      query: 'Initialize draft strategy given these inputs.'
    };

    // Add conversation_id only if provided and truthy
    if (conversationId) {
      difyPayload.conversation_id = conversationId;
    }

    // Set up AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_BLOCKING_TIMEOUT_MS);

    try {
      // Make blocking call to Dify
      const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(difyPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const duration = Date.now() - startTime;
        console.log(`[BLOCKING][initialize] ms=${duration}`);

        return res.json({
          ok: true,
          conversationId: data.conversation_id || null,
          answer: data.answer || null,
          raw: {
            id: data.id || null,
            event: data.event || null
          }
        });
      } else {
        // Non-200 response
        const errorText = await response.text();
        const bodySnippet = errorText.slice(0, 2000);
        
        return res.status(502).json({
          ok: false,
          message: 'Upstream error',
          status: response.status,
          bodySnippet: bodySnippet
        });
      }

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          message: `Upstream timeout after ${LLM_BLOCKING_TIMEOUT_MS} ms`
        });
      } else {
        return res.status(504).json({
          ok: false,
          message: fetchError.message
        });
      }
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[BLOCKING][initialize] ms=${duration}`);
    
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// POST /api/draft/reset - Blocking endpoint to reset draft conversation
router.post('/reset', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { user } = req.body;

    // Validation
    if (!user) {
      return res.status(400).json({
        ok: false,
        message: 'Reset requires: user'
      });
    }

    // Build Dify request payload for reset
    const difyPayload = {
      user: user,
      response_mode: 'blocking',
      inputs: {},
      query: 'RESET_DRAFT: user is starting over. Please acknowledge reset.'
    };

    // Set up AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_BLOCKING_TIMEOUT_MS);

    try {
      // Make blocking call to Dify
      const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DIFY_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(difyPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const duration = Date.now() - startTime;
        console.log(`[BLOCKING][reset] ms=${duration}`);

        // Ignore conversation_id in response; client will clear its stored conversationId
        return res.json({
          ok: true,
          resetAcknowledged: true
        });
      } else {
        // Non-200 response
        const errorText = await response.text();
        const bodySnippet = errorText.slice(0, 2000);
        
        return res.status(502).json({
          ok: false,
          message: 'Upstream error',
          status: response.status,
          bodySnippet: bodySnippet
        });
      }

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          message: `Upstream timeout after ${LLM_BLOCKING_TIMEOUT_MS} ms`
        });
      } else {
        return res.status(504).json({
          ok: false,
          message: fetchError.message
        });
      }
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[BLOCKING][reset] ms=${duration}`);
    
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

module.exports = router;