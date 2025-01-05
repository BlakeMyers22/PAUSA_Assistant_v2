const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Utility function: Safely convert a value to a string, 
 * returning fallback if it's null/undefined or not a string.
 */
function safeString(value, fallback = 'N/A') {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  return fallback;
}

/**
 * Utility function: Safely join an array. If it's not a valid array, 
 * or it's empty, return fallback.
 */
function safeArrayJoin(arr, fallback = 'N/A', separator = ', ') {
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.join(separator);
  }
  return fallback;
}

/**
 * Utility function: Safely parse a date. 
 * If parsing fails or the input is missing, return null.
 */
function safeParseDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Function to fetch historical weather data with safe checks. 
 */
async function getWeatherData(location, dateString) {
  try {
    // If location or date is missing, skip weather call
    if (!location || !dateString) {
      return {
        success: true,
        data: {}
      };
    }

    // Attempt to parse the date
    const dateObj = safeParseDate(dateString);
    if (!dateObj) {
      // If invalid date, skip
      return {
        success: true,
        data: {}
      };
    }

    // Format as YYYY-MM-DD
    const formattedDate = dateObj.toISOString().split('T')[0];

    const response = await axios.get('http://api.weatherapi.com/v1/history.json', {
      params: {
        key: process.env.WEATHER_API_KEY,
        q: location,
        dt: formattedDate
      }
    });

    const dayData = response.data.forecast.forecastday[0].day;
    const hourlyData = response.data.forecast.forecastday[0].hour;

    // Get max wind gust from hourly data
    const maxWindGust = Math.max(...hourlyData.map(hour => hour.gust_mph));
    const maxWindTime = hourlyData.find(hour => hour.gust_mph === maxWindGust)?.time || 'N/A';

    return {
      success: true,
      data: {
        maxTemp: `${dayData.maxtemp_f}°F`,
        minTemp: `${dayData.mintemp_f}°F`,
        avgTemp: `${dayData.avgtemp_f}°F`,
        maxWindGust: `${maxWindGust} mph`,
        maxWindTime: maxWindTime,
        totalPrecip: `${dayData.totalprecip_in} inches`,
        humidity: `${dayData.avghumidity}%`,
        conditions: dayData.condition.text,
        hailPossible: dayData.condition.text.toLowerCase().includes('hail') ? 'Yes' : 'No',
        thunderstorm: dayData.condition.text.toLowerCase().includes('thunder') ? 'Yes' : 'No'
      }
    };
  } catch (error) {
    console.error('Weather API Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate the actual prompt for each section, with safe checks.
 */
async function generateSectionPrompt(sectionName, context, weatherData, customInstructions = '') {
  // Deconstruct context safely:
  const investigationDate = safeString(context?.investigationDate);
  const dateOfLoss = safeString(context?.dateOfLoss);
  const claimTypeString = safeArrayJoin(context?.claimType, 'N/A');
  const propertyType = safeString(context?.propertyType);
  const propertyAge = safeString(context?.propertyAge);
  const constructionType = safeString(context?.constructionType);
  const currentUse = safeString(context?.currentUse);
  const squareFootage = safeString(context?.squareFootage);
  const location = safeString(context?.location);
  
  // Engineer credentials also used in letter
  const engineerName = safeString(context?.engineerName, 'Engineer Name');
  const engineerEmail = safeString(context?.engineerEmail, 'Engineer Email');
  const engineerLicense = safeString(context?.engineerLicense, 'Engineer License Number');
  const engineerPhone = safeString(context?.engineerPhone, 'Engineer Phone');

  // Basic "basePrompts"
  const basePrompts = {
    introduction: `
You are writing the "Introduction" section of a forensic engineering report. Provide a concise overview of the investigation purpose and mention that further details will follow in the subsequent sections.
Emphasize the reason for the inspection, the property type, and the date(s) involved.
Use professional engineering language.
`,

    authorization: `
You are writing the "Authorization and Scope of Investigation" section for a forensic engineering report.

Include a concise background:
- Investigation Date: ${investigationDate}
- Property Name (Project): ${safeString(context?.clientName)}
- Claim Type(s): ${claimTypeString}

Required Points:
1. Who authorized the investigation
2. What the scope of work is
3. Outline the major tasks (site visit, photo documentation, etc.)
4. Mention the presence of attachments/appendices
`,

    background: `
You are writing the "Background Information" section for a forensic engineering report.

Include relevant property details:
- Property Type: ${propertyType}
- Property Age: ${propertyAge} years
- Construction Type: ${constructionType}
- Current Use: ${currentUse}
- Square Footage: ${squareFootage}

Write in professional engineering language, focusing on context needed for the rest of the report.
`,

    observations: `
You are writing the "Site Observations and Analysis" section for a forensic engineering report.

Affected Areas: ${safeArrayJoin(context?.affectedAreas, 'None')}

Required Points:
1) Summarize site observations (roof, siding, etc.)
2) Provide a brief analysis correlating observations with the claimed cause(s)
3) Reference any photos or test measurements as needed
`,

    moisture: `
You are writing the "Survey" section for a forensic engineering report.
Please discuss any moisture or related surveys done on the property. If no moisture issues, mention that as well.
Reference typical investigative tools or techniques.
`,

    meteorologist: `
You are writing the "Meteorologist Report" section, summarizing relevant weather data:

Weather Data: ${JSON.stringify(weatherData, null, 2)}

Focus on wind speeds, hail possibility, precipitation, and how that might correlate to the claimed damages.
`,

    conclusions: `
You are writing the "Conclusions and Recommendations" section for a forensic engineering report.

Required Points:
1) Summarize the main findings
2) Tie them back to the cause(s) of loss
3) Outline recommendations for next steps or repairs
`,

    rebuttal: `
You are writing the "Rebuttal" section. 
If there are any third-party reports or conflicting opinions, address them here in a professional manner. Provide reasoned analysis to support your position.
`,

    limitations: `
You are writing the "Limitations" section for a forensic engineering report.
Include disclaimers regarding scope of inspection, reliance on data from client or third parties, and any other typical engineering disclaimers.
`,

    tableofcontents: `
You are generating a "Table of Contents" for a forensic engineering report which will include:

1. Opening Letter
2. Introduction
3. Authorization and Scope of Investigation
4. Background Information
5. Site Observations and Analysis
6. Survey
7. Meteorologist Report
8. Conclusions and Recommendations
9. Rebuttal
10. Limitations

Provide a clear table of contents in Markdown format with these headings.
`,

    openingletter: `
You are writing an "Opening Letter" for the final forensic engineering report. It should appear before the Table of Contents in the final deliverable.

Use the following style as a reference, adjusting to reflect the user's context:

---
Date of Loss: ${dateOfLoss}
Cause(s): ${claimTypeString}
Property: ${safeString(context?.clientName)}
Location: ${location}

Dear [Recipient]:

North Star Forensics, LLC (NSF) is pleased to submit this report for the above-referenced file. 
By signature below, this report was authorized and prepared under the direct supervision of the undersigned professional.

Please contact us if you have any questions regarding this report.

Signed,

${engineerName}
License No. ${engineerLicense}
Email: ${engineerEmail}
Phone: ${engineerPhone}
---

Ensure professional language and a concise, welcoming tone.
`
  };

  // Normalize the section name to lower case, removing trailing/leading spaces
  const normalizedSection = (sectionName || '').trim().toLowerCase();

  // If we don't have a base prompt for this section, default to a generic
  const basePrompt = basePrompts[normalizedSection] 
    || `Write a professional engineering section about '${sectionName}'.`;

  // Merge custom instructions safely
  const safeCustom = safeString(customInstructions, '');
  const finalPrompt = safeCustom
    ? `${basePrompt}\n\nAdditional Instructions: ${safeCustom}`
    : basePrompt;

  return finalPrompt;
}

// MAIN HANDLER
exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const { section, context: userContext, customInstructions } = JSON.parse(event.body) || {};

    // If the user is generating tableOfContents or openingLetter or introduction, 
    // we don't need weather data. For everything else, let's try to fetch it safely.
    let weatherResult = { success: true, data: {} };

    if (!['tableOfContents', 'openingLetter', 'introduction'].includes(
      (section || '').trim().toLowerCase()
    )) {
      // Attempt to parse dateOfLoss
      const dateObj = safeParseDate(userContext?.dateOfLoss);
      let dateToUse = null;
      if (dateObj) {
        dateToUse = dateObj.toISOString().split('T')[0];
      }

      if (userContext?.location && dateToUse) {
        // Attempt weather fetch
        weatherResult = await getWeatherData(userContext.location, dateToUse);
      }
    }

    const prompt = await generateSectionPrompt(section, userContext, weatherResult.data, customInstructions);

    // If for any reason prompt is still empty or null, default to a safe string
    const finalPrompt = prompt || 'No prompt data available. Please proceed.';

    const completion = await openai.chat.completions.create({
      model: 'chatgpt-4o-latest',
      messages: [
        {
          role: 'system',
          content: `You are an expert forensic engineer generating professional report sections. 
Guidelines:
1. Use formal, technical language
2. Include specific context details
3. Maintain logical flow
4. Support conclusions with evidence
5. Reference documentation appropriately
6. Use unique phrasing
7. Ensure completeness
8. Incorporate custom instructions while maintaining standards`
        },
        {
          role: 'user',
          content: finalPrompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        section: completion.choices[0].message.content || '',
        sectionName: section,
        weatherData: weatherResult.data
      })
    };

  } catch (error) {
    console.error('Error in generate-report function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to generate report section',
        details: error.message
      })
    };
  }
};
