package app

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// parseListSearch validates an optional literal substring search shared by paged lists.
// The returned pattern is safe to bind to ILIKE with ESCAPE E'\\'.
func parseListSearch(rawQuery string) (url.Values, string, bool, error) {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return nil, "", false, errors.New("Sorgu geçersiz.")
	}
	searchValues, present := values["q"]
	if !present {
		return values, "", false, nil
	}
	if len(searchValues) != 1 || !utf8.ValidString(searchValues[0]) {
		return nil, "", false, errors.New("Arama ifadesi geçersiz.")
	}
	for _, char := range searchValues[0] {
		if unicode.IsControl(char) {
			return nil, "", false, errors.New("Arama ifadesi kontrol karakteri içeremez.")
		}
	}
	search := strings.TrimSpace(searchValues[0])
	if length := utf8.RuneCountInString(search); length < 3 || length > 120 {
		return nil, "", false, errors.New("Arama ifadesi 3–120 karakter olmalı.")
	}
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search) + "%"
	return values, pattern, true, nil
}

// parseListPage keeps omitted pagination parameters distinct from invalid values.
func parseListPage(values url.Values) (int, int64, error) {
	limit, cursor := 50, int64(0)
	if supplied, present := values["limit"]; present {
		if len(supplied) != 1 || !canonicalPositiveDecimal(supplied[0]) {
			return 0, 0, errors.New("Sayfa boyutu 1 ile 100 arasında olmalı.")
		}
		value, err := strconv.ParseInt(supplied[0], 10, 64)
		if err != nil || value > 100 {
			return 0, 0, errors.New("Sayfa boyutu 1 ile 100 arasında olmalı.")
		}
		limit = int(value)
	}
	if supplied, present := values["cursor"]; present {
		if len(supplied) != 1 || !canonicalPositiveDecimal(supplied[0]) {
			return 0, 0, errors.New("Sayfalama imleci geçersiz.")
		}
		value, err := strconv.ParseInt(supplied[0], 10, 64)
		if err != nil {
			return 0, 0, errors.New("Sayfalama imleci geçersiz.")
		}
		cursor = value
	}
	return limit, cursor, nil
}

func canonicalPositiveDecimal(value string) bool {
	if value == "" || value[0] < '1' || value[0] > '9' {
		return false
	}
	for i := 1; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return false
		}
	}
	return true
}
