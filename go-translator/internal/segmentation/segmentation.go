package segmentation

import (
	"math"
	"path/filepath"
	"regexp"
	"strings"
)

// Default markers for different file types (matching the extension defaults).
var defaultSegmentationMarkers = map[string][]string{
	"markdown":   {"^#\\s", "^##\\s", "^###\\s"},
	"html":       {"^<h1[^>]*>", "^<h2[^>]*>", "^<h3[^>]*>"},
	"javascript": {"^function\\s+\\w+\\(", "^class\\s+\\w+"},
	"typescript": {"^function\\s+\\w+\\(", "^class\\s+\\w+", "^interface\\s+\\w+"},
	"python":     {"^def\\s+\\w+\\(", "^class\\s+\\w+"},
	"java":       {"^public\\s+(class|interface|enum)\\s+\\w+", "^\\s*public\\s+\\w+\\s+\\w+\\("},
	"go":         {"^func\\s+\\w+\\(", "^type\\s+\\w+\\s+struct"},
	"csharp":     {"^public\\s+(class|interface|enum)\\s+\\w+", "^\\s*public\\s+\\w+\\s+\\w+\\("},
	"php":        {"^function\\s+\\w+\\(", "^class\\s+\\w+"},
	"ruby":       {"^def\\s+\\w+", "^class\\s+\\w+"},
	"rust":       {"^fn\\s+\\w+", "^struct\\s+\\w+", "^enum\\s+\\w+"},
	"swift":      {"^func\\s+\\w+", "^class\\s+\\w+", "^struct\\s+\\w+"},
	"kotlin":     {"^fun\\s+\\w+", "^class\\s+\\w+"},
	"plaintext":  {"^\\s*$"}, // split on empty lines
}

var extensionToLanguageMap = map[string]string{
	"md":       "markdown",
	"markdown": "markdown",
	"html":     "html",
	"htm":      "html",
	"js":       "javascript",
	"jsx":      "javascript",
	"ts":       "typescript",
	"tsx":      "typescript",
	"py":       "python",
	"java":     "java",
	"go":       "go",
	"cs":       "csharp",
	"php":      "php",
	"rb":       "ruby",
	"rs":       "rust",
	"swift":    "swift",
	"kt":       "kotlin",
	"txt":      "plaintext",
}

// EstimateTokenCount approximates GPT-style token count:
// - ~1 token per 4 chars (minimum 1 per whitespace-separated word)
// - adds punctuation tokens
func EstimateTokenCount(text string) int {
	if strings.TrimSpace(text) == "" {
		return 0
	}

	words := strings.Fields(text)
	tokenCount := 0
	for _, w := range words {
		tokenCount += int(math.Max(1, math.Ceil(float64(len(w))/4.0)))
	}

	// Count common punctuation / special chars
	for _, r := range text {
		switch r {
		case '.', ',', '!', '?', ';', ':', '(', ')', '[', ']', '{', '}', '\'', '"':
			tokenCount++
		}
	}
	return tokenCount
}

func languageFromPath(filePath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	if ext == "" {
		return "plaintext"
	}
	if lang, ok := extensionToLanguageMap[ext]; ok {
		return lang
	}
	return "plaintext"
}

// SegmentText segments text into chunks under maxTokens, splitting at marker lines when possible.
// customMarkers overrides defaults by language key.
func SegmentText(text string, filePath string, maxTokens int, customMarkers map[string][]string) []string {
	if maxTokens <= 0 {
		maxTokens = 3800
	}

	if EstimateTokenCount(text) <= maxTokens {
		return []string{text}
	}

	lang := languageFromPath(filePath)
	markers := []string(nil)
	if customMarkers != nil {
		if ms, ok := customMarkers[lang]; ok && len(ms) > 0 {
			markers = ms
		}
	}
	if markers == nil {
		if ms, ok := defaultSegmentationMarkers[lang]; ok {
			markers = ms
		} else {
			markers = defaultSegmentationMarkers["plaintext"]
		}
	}

	patterns := make([]*regexp.Regexp, 0, len(markers))
	for _, m := range markers {
		re, err := regexp.Compile(m)
		if err != nil {
			continue
		}
		patterns = append(patterns, re)
	}

	lines := strings.Split(text, "\n")
	segments := []string{}
	current := []string{}
	currentTokens := 0
	lastMarkerIndex := -1
	lastMarkerTokens := 0

	for _, line := range lines {
		lineTokens := EstimateTokenCount(line)
		isMarker := false
		for _, re := range patterns {
			if re.MatchString(line) {
				isMarker = true
				break
			}
		}

		if isMarker {
			if len(current) == 0 {
				current = append(current, line)
				currentTokens = lineTokens
				continue
			}
			lastMarkerIndex = len(current)
			lastMarkerTokens = currentTokens
		}

		if currentTokens+lineTokens > maxTokens {
			if lastMarkerIndex > 0 {
				segments = append(segments, strings.Join(current[:lastMarkerIndex], "\n"))
				remaining := append([]string{}, current[lastMarkerIndex:]...)
				current = append(remaining, line)
				currentTokens = currentTokens - lastMarkerTokens + lineTokens
			} else {
				segments = append(segments, strings.Join(current, "\n"))
				current = []string{line}
				currentTokens = lineTokens
			}
			lastMarkerIndex = -1
			lastMarkerTokens = 0
			continue
		}

		current = append(current, line)
		currentTokens += lineTokens
	}

	if len(current) > 0 {
		segments = append(segments, strings.Join(current, "\n"))
	}
	return segments
}

func CombineSegments(segments []string) string {
	return strings.Join(segments, "\n")
}
