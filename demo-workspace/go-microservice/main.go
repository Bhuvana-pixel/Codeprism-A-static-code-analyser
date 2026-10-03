package main

import "fmt"

type AnalyticsService struct {
	Metrics []string
}

func (a *AnalyticsService) TrackEvent(name string) {
	fmt.Println("Tracking event:", name)
}

func main() {
	service := &AnalyticsService{}
	service.TrackEvent("CodePrismWorkspaceAnalyzed")
}
