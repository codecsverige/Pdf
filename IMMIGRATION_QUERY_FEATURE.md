# Immigration Query Feature

## Overview
This feature allows users to submit immigration and work-related queries in Arabic and receive automated analysis and recommendations.

## Implementation

### Component: `ImmigrationQuery.tsx`
- Located in `/workspace/components/ImmigrationQuery.tsx`
- Provides a form for users to input their immigration queries
- Analyzes queries based on keywords and context
- Returns structured analysis including:
  - Detailed analysis of the situation
  - Recommendations and probability assessment
  - Influencing factors
  - Disclaimer about seeking professional legal advice

### Integration in Main App
The feature is integrated into the main `App.tsx` as a modal that can be accessed via a new button:
- Button text: "استفسار هجرة" (Immigration Query)
- Opens in a slide-up modal
- Can be closed using the close button

## Supported Query Types

### Swedish Immigration
The system currently recognizes and analyzes queries related to:
- Family reunification permits (لم شمل)
- Permanent residence applications (إقامة دائمة)
- Employment and A-kassa status
- Family members with Swedish citizenship

### Analysis Factors
The system considers:
1. **Duration of legal residence** - How long the applicant has lived in the country
2. **Family ties** - Spouse/children with citizenship or permanent residence
3. **Employment status** - Current employment or unemployment benefits (A-kassa)
4. **Financial support** - Self-sufficiency or family support
5. **Integration factors** - Language courses, cultural integration

## Example Query

**Input (Arabic):**
```
اعيش في سويد و جات لم شمل و لدي ابن و زوجتي عندهم جنسية سويدية .اخذت المرة الأولى 2 سنة في إقامة لم شمل و المرة الثانية قمت بتحديد بسنتين و الان قدمت علي الدائمة و ليس لي عمل لدي اكاسا . هل يقبلون ام لا
```

**Output includes:**
- Detailed analysis of the 4-year residency period
- Strong positive factors (family with Swedish citizenship)
- Considerations (unemployment but with A-kassa registration)
- Specific recommendations for strengthening the application
- List of influencing factors
- Legal disclaimer

## Technical Details

### State Management
- Uses React hooks (`useState`) for query input and results
- Processing simulation with 1-second delay for UX

### Styling
- RTL (Right-to-Left) layout for Arabic text
- Color-coded sections for better readability
- Responsive design with ScrollView for long results
- Warning disclaimer in red background

### Future Enhancements
- Support for more countries (Germany, Canada, etc.)
- Integration with actual immigration law databases
- Multi-language support (Arabic, English, Swedish)
- Save/export query results as PDF
- Connection to legal consultation services

## Disclaimer
⚠️ This is an informational tool only. Users should always consult with qualified immigration lawyers for legal advice specific to their situation.
