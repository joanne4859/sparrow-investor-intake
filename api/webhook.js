// api/dealmaker-webhook.js

/**
 * DealMaker Webhook Handler
 * 
 * Receives webhooks from DealMaker when investor events occur
 * Updates Notion CRM with event triggers and status changes
 * 
 * Webhook Events Handled:
 * - investor.create → Set checkout2_started
 * - investor.update → Update consent fields and investor_state
 * - investor.funded → Set investor_funded_status
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const event = req.body;
    
    console.log('=== DEALMAKER WEBHOOK RECEIVED ===');
    console.log('Event type:', event.event);
    console.log('Investor email:', event.data?.email);

    const investor = event.data;
    
    // Base payload for all events
    const notionPayload = {
      email: investor.email,
      update_existing: true
    };

    // Handle different event types
    switch (event.event) {
      
      // ===== INVESTOR CREATED =====
      case 'investor.create':
        console.log('✓ Investor created:', investor.email);
        
        await updateNotion({
          ...notionPayload,
          checkout2_started: true,
          investor_state: investor.state || 'invited'
        });
        break;

      // ===== INVESTOR UPDATED =====
      case 'investor.update':
        console.log('✓ Investor updated:', investor.email);
        
        const updatePayload = {
          ...notionPayload,
          investor_state: investor.state
        };

        // Update consent if changed (both map to same DealMaker field)
        if (investor.promotional_marketing_consent !== undefined) {
          updatePayload.marketing_consent = investor.promotional_marketing_consent;
          updatePayload.sms_consent = investor.promotional_marketing_consent;
          
          console.log('  - Consent updated:', investor.promotional_marketing_consent);
        }

        await updateNotion(updatePayload);
        break;

      // ===== INVESTOR FUNDED (Payment Completed) =====
      case 'investor.funded':
        console.log('✓ Payment completed (funded):', investor.email);
        
        await updateNotion({
          ...notionPayload,
          investor_funded_status: true,
          investor_state: investor.state  // Usually 'investor' or 'accepted'
        });
        break;

      // ===== OTHER EVENTS (Logged but not handled) =====
      default:
        console.log('ℹ Unhandled event type:', event.event);
        // Still update investor_state for any event
        await updateNotion({
          ...notionPayload,
          investor_state: investor.state
        });
    }

    console.log('=== WEBHOOK PROCESSED SUCCESSFULLY ===');

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      event_type: event.event
    });

  } catch (error) {
    console.error('=== WEBHOOK ERROR ===');
    console.error(error);
    
    return res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
}

/**
 * Helper function to update Notion
 */
async function updateNotion(payload) {
  try {
    const notionApiUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/save_to_notion`
      : 'https://sparrow-investor-intake.vercel.app/api/save_to_notion';

    console.log('  → Updating Notion...');
    
    const response = await fetch(notionApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Notion update failed: ${data.message}`);
    }

    console.log('  ✓ Notion updated:', data.action, data.entry_id);
    return data;

  } catch (error) {
    console.error('  ✗ Failed to update Notion:', error);
    throw error;
  }
}