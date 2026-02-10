const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Main serverless function handler
 * Handles progressive form autosave to Notion CRM
 * WITH: Duplicate prevention + Investment tracking + UTM parameters + 
 *       Event triggers + DealMaker integration + ActiveCampaign prep
 */
module.exports = async (req, res) => {
  // Enable CORS for Webflow domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    // Extract all fields from request body
    const { 
      // ===== CONTACT INFO =====
      first_name, 
      last_name, 
      phone_number, 
      email,
      
      // ===== ADDRESS INFO =====
      street_address,
      unit2,
      city,
      region,
      postal_code,
      country,
      
      // ===== INVESTMENT INFO =====
      investment_amount,
      is_accredited,
      
      // ===== SYSTEM FIELDS =====
      entry_id,
      update_existing,
      
      // ===== UTM PARAMETERS =====
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      
      // ===== EVENT TRIGGERS (Boolean) =====
      entered_funnel,
      checkout2_started,
      investor_funded_status,
      investor_deck_downloaded_ecf26,
      
      // ===== CONSENT FIELDS =====
      marketing_consent,
      sms_consent,
      
      // ===== DEALMAKER INTEGRATION =====
      investor_state,
      
      // ===== ACTIVECAMPAIGN FIELDS =====
      ac_sync_status,
      tags
    } = req.body;

    // Only save if email OR phone is provided
    if (!email && !phone_number) {
      return res.status(400).json({
        error: 'Contact method required',
        message: 'Must provide email or phone number before saving'
      });
    }

    // Search for existing entry by email or phone (duplicate prevention)
    let existingEntry = null;
    let matchedBy = null;
    
    if (update_existing && !entry_id) {
      try {
        const filters = [];
        
        if (email) {
          filters.push({
            property: "Email",
            email: { equals: email }
          });
        }
        
        if (phone_number) {
          filters.push({
            property: "Phone",
            phone_number: { equals: phone_number }
          });
        }
        
        const searchResults = await notion.databases.query({
          database_id: DATABASE_ID,
          filter: filters.length > 1 
            ? { or: filters } 
            : filters[0]
        });
        
        if (searchResults.results.length > 0) {
          existingEntry = searchResults.results[0];
          
          // Determine which field matched
          const props = existingEntry.properties;
          if (props.Email?.email === email) {
            matchedBy = 'email';
          } else if (props.Phone?.phone_number === phone_number) {
            matchedBy = 'phone';
          }
          
          console.log(`Found existing entry (matched by ${matchedBy}):`, existingEntry.id);
        }
      } catch (error) {
        console.error('Error searching for existing entry:', error);
        // Continue with creation if search fails
      }
    }

    // Prepare properties for Notion database
    const properties = {
      Name: {
        title: [
          {
            text: {
              content: `${first_name || ''} ${last_name || ''}`.trim() || 'No name provided'
            }
          }
        ]
      }
    };

    // ===== CONTACT INFORMATION =====
    if (email) {
      properties['Email'] = {
        email: email
      };
    }

    if (phone_number) {
      properties['Phone'] = {
        phone_number: phone_number
      };
    }

    // ===== ADDRESS INFORMATION =====
    if (street_address || unit2 || city || region || postal_code || country) {
      const addressParts = [
        street_address,
        unit2,
        city,
        region,
        postal_code,
        country
      ].filter(Boolean);
      
      if (addressParts.length > 0) {
        properties['Address'] = {
          rich_text: [{ text: { content: addressParts.join(', ') } }]
        };
      }
    }

    // ===== INVESTMENT INFORMATION =====
    if (investment_amount) {
      properties['Investment Amount'] = {
        number: parseFloat(investment_amount)
      };
    }

    if (is_accredited !== undefined) {
      properties['Accredited Investor'] = {
        checkbox: is_accredited
      };
    }

    // ===== UTM PARAMETERS =====
    if (utm_source) {
      properties['UTM Source'] = {
        rich_text: [{ text: { content: utm_source } }]
      };
    }

    if (utm_medium) {
      properties['UTM Medium'] = {
        rich_text: [{ text: { content: utm_medium } }]
      };
    }

    if (utm_campaign) {
      properties['UTM Campaign'] = {
        rich_text: [{ text: { content: utm_campaign } }]
      };
    }

    if (utm_content) {
      properties['UTM Content'] = {
        rich_text: [{ text: { content: utm_content } }]
      };
    }

    if (utm_term) {
      properties['UTM Term'] = {
        rich_text: [{ text: { content: utm_term } }]
      };
    }

    // ===== EVENT TRIGGERS (Boolean Status Fields) =====
    if (entered_funnel !== undefined) {
      properties['status: entered_funnel_ecf26'] = {
        checkbox: entered_funnel
      };
    }

    if (checkout2_started !== undefined) {
      properties['action: checkout2_started_ecf26'] = {
        checkbox: checkout2_started
      };
    }

    if (investor_funded_status !== undefined) {
      properties['investor_funded_status_ecf26'] = {
        checkbox: investor_funded_status
      };
    }

    if (investor_deck_downloaded_ecf26 !== undefined) {
      properties['status: entered_funnel_pitch_ecf26'] = {
        checkbox: investor_deck_downloaded_ecf26
      };
    }

    // ===== CONSENT FIELDS =====
    if (marketing_consent !== undefined) {
      properties['Marketing Consent'] = {
        checkbox: marketing_consent
      };
    }

    if (sms_consent !== undefined) {
      properties['SMS Consent'] = {
        checkbox: sms_consent
      };
    }

    // ===== DEALMAKER INTEGRATION =====
    if (investor_state) {
      properties['investor_state_ecf26'] = {
        select: { name: investor_state }
      };
    }

    // ===== ACTIVECAMPAIGN INTEGRATION =====
    if (ac_sync_status) {
      properties['AC Sync Status'] = {
        select: { name: ac_sync_status }
      };
    }

    if (tags && Array.isArray(tags) && tags.length > 0) {
      properties['Tags'] = {
        multi_select: tags.map(tag => ({ name: tag }))
      };
    }

    // ===== TIMESTAMPS =====
    const now = new Date().toISOString();
    
    // Determine which entry ID to use (existing match or provided entry_id)
    const targetEntryId = existingEntry?.id || entry_id;
    
    // If this is a new entry, set Created At timestamp
    if (!targetEntryId) {
      properties['Created At'] = {
        date: { start: now }
      };
    }
    
    // Always update Last Updated timestamp
    properties['Last Updated'] = {
      date: { start: now }
    };

    // ===== GROUP RELATION =====
    // Automatically assigns to "ECF - DM" group
    properties['Group'] = {
      relation: [
        { id: '2e110ef8d70d80aa872fc31246ca1f85' }
      ]
    };

    // ===== UPDATE OR CREATE ENTRY =====
    if (targetEntryId) {
      // Update existing Notion page
      const response = await notion.pages.update({
        page_id: targetEntryId,
        properties: properties
      });

      return res.status(200).json({
        success: true,
        message: 'Entry updated successfully',
        entry_id: response.id,
        action: 'updated',
        matched_by: matchedBy
      });
    } else {
      // Create new Notion page
      const response = await notion.pages.create({
        parent: {
          database_id: DATABASE_ID
        },
        properties: properties
      });

      return res.status(200).json({
        success: true,
        message: 'New entry created successfully',
        entry_id: response.id,
        action: 'created'
      });
    }

  } catch (error) {
    console.error('Error saving to Notion:', error);
    
    return res.status(500).json({
      error: 'Failed to save to Notion',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
};