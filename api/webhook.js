// api/dealmaker-webhook.js

/**
 * DealMaker Webhook Handler
 * 
 * Receives webhooks from DealMaker when investor events occur
 * Extracts investment details and updates Notion CRM
 * 
 * Webhook Events Handled:
 * - investor.create → Set checkout2_started + capture deal details
 * - investor.update → Update investor state + investment details
 * - investor.funded → Set investor_funded_status + payment complete
 * - investor.signed → Capture signed agreement details
 * - investor.accepted → Final acceptance (countersigned)
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DealMaker-Signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const webhookPayload = req.body;
    
    console.log('=== DEALMAKER WEBHOOK RECEIVED ===');
    console.log('Event type:', webhookPayload.event);
    console.log('Event ID:', webhookPayload.event_id);

    const investor = webhookPayload.investor;
    const deal = webhookPayload.deal;
    
    if (!investor || !investor.email) {
      console.error('Missing investor email in webhook');
      return res.status(400).json({ error: 'Missing investor email' });
    }

    console.log('Investor email:', investor.email);
    console.log('Investor ID:', investor.id);
    console.log('Deal:', deal?.title);

    // ===== BASE PAYLOAD =====
    const notionPayload = {
      email: investor.email,
      first_name: investor.first_name || '',
      last_name: investor.last_name || '',
      phone_number: investor.phone_number || '',
      update_existing: true
    };

    // ===== EXTRACT DEAL INFORMATION (from deal object) =====
    if (deal) {
      // Security type (e.g., "Common Stock", "Preferred Shares")
      if (deal.security_type) {
        notionPayload.security_type_ecf26 = deal.security_type;
        console.log('  - Security type:', deal.security_type);
      }

      // Price per security (e.g., 10.50)
      if (deal.price_per_security !== undefined) {
        notionPayload.investor_price_ecf26 = deal.price_per_security;
        console.log('  - Price per security:', deal.price_per_security);
      }
    }

    // ===== EXTRACT INVESTOR INVESTMENT DETAILS =====
    
    // Number of securities purchased
    if (investor.number_of_securities !== undefined) {
      notionPayload.number_of_securities_ecf26 = investor.number_of_securities;
      console.log('  - Number of securities:', investor.number_of_securities);
    }

    // Investment amount (base investment)
    if (investor.investment_amount !== undefined) {
      notionPayload.amount_dollars_ecf26 = investor.investment_amount;
      console.log('  - Investment amount:', investor.investment_amount);
    }

    // Total allocated amount (may include bonuses/fees)
    if (investor.allocated_amount !== undefined) {
      notionPayload.total_amount_dollars_ecf26 = investor.allocated_amount;
      console.log('  - Total allocated amount:', investor.allocated_amount);
    }

    // Funds/payment state
    if (investor.funding_state) {
      notionPayload.funds_state_ecf26 = investor.funding_state;
      console.log('  - Funding state:', investor.funding_state);
    }

    // ===== INVESTOR STATE & STATUS =====
    if (investor.state) {
      notionPayload.investor_state = investor.state;
      console.log('  - Investor state:', investor.state);
    }

    // ===== CONSENT FIELDS =====
    if (investor.promotional_marketing_consent !== undefined) {
      notionPayload.marketing_consent = investor.promotional_marketing_consent;
      notionPayload.sms_consent = investor.promotional_marketing_consent;
      console.log('  - Marketing consent:', investor.promotional_marketing_consent);
    }

    // ===== ADDRESS INFORMATION (if available) =====
    if (investor.beneficial_address) {
      notionPayload.street_address = investor.beneficial_address;
      console.log('  - Address:', investor.beneficial_address);
    }

    // ===== CALCULATE ANCILLARY FEES (if available) =====
    // DealMaker doesn't directly provide fees, but we can calculate:
    // Ancillary fees = allocated_amount - investment_amount
    if (investor.allocated_amount !== undefined && investor.investment_amount !== undefined) {
      const calculatedFees = investor.allocated_amount - investor.investment_amount;
      if (calculatedFees > 0) {
        notionPayload.ancillary_fees_ecf26 = calculatedFees;
        console.log('  - Calculated fees:', calculatedFees);
      }
    }

    // ===== BONUS SHARES CALCULATION =====
    // Note: DealMaker may include this in investor_tiers or tags
    // Check if investor has any bonus/incentive tier information
    if (investor.tags && Array.isArray(investor.tags)) {
      // Look for bonus-related tags
      const bonusTags = investor.tags.filter(tag => 
        tag.toLowerCase().includes('bonus') || 
        tag.toLowerCase().includes('free_shares')
      );
      
      if (bonusTags.length > 0) {
        console.log('  - Bonus tags found:', bonusTags);
        // You might need to parse these tags to extract the actual bonus amount
        // For now, we'll just log them
      }
    }

    // ===== EVENT-SPECIFIC HANDLING =====
    switch (webhookPayload.event) {
      
      // ===== INVESTOR CREATED =====
      case 'investor.create':
        console.log('✓ Investor created - checkout started');
        notionPayload.checkout2_started = true;
        break;

      // ===== INVESTOR UPDATED =====
      case 'investor.update':
        console.log('✓ Investor updated');
        // Payload already has all updated fields
        break;

      // ===== INVESTOR SIGNED =====
      case 'investor.signed':
        console.log('✓ Agreement signed');
        // Mark that they've signed
        notionPayload.investor_state = 'signed';
        break;

      // ===== INVESTOR FUNDED =====
      case 'investor.funded':
        console.log('✓ Payment completed (funded)');
        notionPayload.investor_funded_status = true;
        notionPayload.investor_state = 'funded';
        break;

      // ===== INVESTOR ACCEPTED =====
      case 'investor.accepted':
        console.log('✓ Investment accepted (countersigned)');
        notionPayload.investor_state = 'accepted';
        break;

      // ===== OTHER EVENTS =====
      default:
        console.log('ℹ Event type:', webhookPayload.event);
    }

    // ===== UPDATE NOTION =====
    console.log('\n📝 Updating Notion with payload:');
    console.log(JSON.stringify(notionPayload, null, 2));
    
    const result = await updateNotion(notionPayload);
    
    console.log('\n=== WEBHOOK PROCESSED SUCCESSFULLY ===\n');

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      event_type: webhookPayload.event,
      notion_action: result.action,
      notion_entry_id: result.entry_id
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
    // Use the same Notion API endpoint you're already using
    const notionApiUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/save_to_notion`
      : 'https://sparrow-investor-intake.vercel.app/api/save_to_notion';

    console.log('  → Calling Notion API...');
    
    const response = await fetch(notionApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Notion update failed: ${data.message || 'Unknown error'}`);
    }

    console.log('  ✓ Notion updated:', data.action, data.entry_id);
    return data;

  } catch (error) {
    console.error('  ✗ Failed to update Notion:', error);
    throw error;
  }
}