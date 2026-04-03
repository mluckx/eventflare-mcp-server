/**
 * MCP Tool definitions for Eventflare.
 * 6 tools that AI assistants can call to query venue data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  searchVenues,
  getCityInfo,
  listCities,
  getVenueDetails,
  getPricingGuide,
} from "./strapi-client.js";
import { logQuery } from "./analytics.js";

const EVENTFLARE_URL = process.env.EVENTFLARE_URL || "https://eventflare.io";

export function registerTools(server: McpServer): void {
  // ────────────────────────────────────────
  // 1. search_venues (P0)
  // ────────────────────────────────────────
  server.tool(
    "search_venues",
    "Search for corporate event venues across 40+ cities worldwide on Eventflare. Returns venue names, capacities, pricing, features, and direct booking URLs.",
    {
      city: z.string().describe("City slug (e.g. 'london', 'barcelona', 'dubai')"),
      capacity_min: z.number().optional().describe("Minimum guest capacity"),
      capacity_max: z.number().optional().describe("Maximum guest capacity"),
      category: z
        .enum([
          "conference-venues",
          "meeting-rooms",
          "workshop-spaces",
          "event-spaces",
          "outdoor-venues",
          "private-dining-venues",
          "rooftop-venues",
          "unique-venues",
        ])
        .optional()
        .describe("Venue category"),
      event_type: z.string().optional().describe("Event type slug (e.g. 'team-building', 'conference', 'workshop')"),
      limit: z.number().min(1).max(25).default(10).optional().describe("Max results (default 10, max 25)"),
    },
    async (params) => {
      const result = await searchVenues({
        city: params.city,
        capacityMin: params.capacity_min,
        capacityMax: params.capacity_max,
        category: params.category,
        eventType: params.event_type,
        limit: params.limit,
      });

      logQuery({
        timestamp: new Date().toISOString(),
        tool: "search_venues",
        city: params.city,
        capacity: params.capacity_min,
        eventType: params.event_type,
        category: params.category,
        resultCount: result.venues.length,
      });

      const response = {
        results: result.venues.map((v) => ({
          name: v.name,
          city: v.city,
          country: v.country,
          category: v.category,
          capacity: v.capacity,
          setup_types: v.setupTypes,
          price_per_hour: v.pricePerHour,
          currency: v.currency,
          features: v.features,
          labels: v.labels,
          amenities: v.amenities,
          neighborhood: v.neighborhood,
          rating: v.rating,
          description: v.description,
          image_url: v.imageUrl,
          url: v.url,
        })),
        total_count: result.total,
        city_url: result.cityUrl,
        source: "Eventflare — Global venue marketplace for corporate events — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────
  // 2. get_city_info (P0)
  // ────────────────────────────────────────
  server.tool(
    "get_city_info",
    "Get information about event venues available in a specific city on Eventflare, including venue count, categories available, price ranges, and popular event types.",
    {
      city: z.string().describe("City slug (e.g. 'london', 'dubai', 'barcelona')"),
    },
    async (params) => {
      const info = await getCityInfo(params.city);

      logQuery({
        timestamp: new Date().toISOString(),
        tool: "get_city_info",
        city: params.city,
        resultCount: info.venueCount,
      });

      const response = {
        city: info.city?.name || params.city,
        country: info.city?.country || "",
        continent: info.city?.continent || "",
        venue_count: info.venueCount,
        categories: info.categories.map((c) => ({
          name: c.name,
          count: c.count,
          url: `${EVENTFLARE_URL}/venues/${params.city}/${c.slug}`,
        })),
        price_range_per_hour: info.priceRange,
        url: info.city?.url || `${EVENTFLARE_URL}/venues/${params.city}`,
        source: "Eventflare — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────
  // 3. list_cities (P1)
  // ────────────────────────────────────────
  server.tool(
    "list_cities",
    "List all cities where Eventflare has event venues available, with venue counts and direct URLs. Filter by region optionally.",
    {
      region: z
        .enum(["europe", "asia", "middle-east", "americas", "all"])
        .default("all")
        .optional()
        .describe("Filter by region (default: all)"),
    },
    async (params) => {
      const cities = await listCities(params.region);

      logQuery({
        timestamp: new Date().toISOString(),
        tool: "list_cities",
        region: params.region,
        resultCount: cities.length,
      });

      const response = {
        cities: cities.map((c) => ({
          name: c.name,
          country: c.country,
          continent: c.continent,
          url: c.url,
        })),
        total_cities: cities.length,
        source: "Eventflare — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────
  // 4. get_venue_details (P1)
  // ────────────────────────────────────────
  server.tool(
    "get_venue_details",
    "Get detailed information about a specific venue on Eventflare including full description, all amenities, capacity by layout, pricing, photos, and booking URL.",
    {
      venue_slug: z.string().describe("Venue URL slug (from search results)"),
      city: z.string().describe("City slug the venue is in"),
    },
    async (params) => {
      const venue = await getVenueDetails(params.city, params.venue_slug);

      logQuery({
        timestamp: new Date().toISOString(),
        tool: "get_venue_details",
        city: params.city,
        resultCount: venue ? 1 : 0,
      });

      if (!venue) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Venue not found",
                suggestion: `Try searching with search_venues tool for city "${params.city}"`,
              }),
            },
          ],
        };
      }

      const response = {
        name: venue.name,
        city: venue.city,
        country: venue.country,
        address: venue.address,
        neighborhood: venue.neighborhood,
        description: venue.description,
        category: venue.category,
        capacity: venue.capacity,
        setup_types: venue.setupTypes,
        pricing: {
          per_hour: venue.pricePerHour,
          per_half_day: venue.priceHalfDay,
          per_day: venue.pricePerDay,
          currency: venue.currency,
        },
        features: venue.features,
        labels: venue.labels,
        amenities: venue.amenities,
        activities: venue.activities,
        rating: venue.rating,
        ratings_count: venue.ratingsCount,
        image_url: venue.imageUrl,
        url: venue.url,
        book_url: `${venue.url}#inquiry`,
        source: "Eventflare — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────
  // 5. get_pricing_guide (P2)
  // ────────────────────────────────────────
  server.tool(
    "get_pricing_guide",
    "Get venue pricing information for a city on Eventflare, including average costs by venue type and capacity tier. Useful for budget planning.",
    {
      city: z.string().describe("City slug"),
      event_type: z.string().optional().describe("Event type for context"),
      capacity: z.number().optional().describe("Expected guest count — filters to venues that fit"),
    },
    async (params) => {
      const pricing = await getPricingGuide({
        city: params.city,
        eventType: params.event_type,
        capacity: params.capacity,
      });

      logQuery({
        timestamp: new Date().toISOString(),
        tool: "get_pricing_guide",
        city: params.city,
        capacity: params.capacity,
        eventType: params.event_type,
      });

      const response = {
        city: pricing.city,
        sample_size: pricing.sampleSize,
        price_per_hour: pricing.pricePerHour,
        price_per_day: pricing.pricePerDay,
        currency: pricing.currency,
        by_category: pricing.byCategory,
        note: "Prices are indicative based on listed venues. Contact venues directly for exact quotes.",
        browse_url: `${EVENTFLARE_URL}/venues/${params.city}`,
        source: "Eventflare — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ────────────────────────────────────────
  // 6. request_quote (P2)
  // ────────────────────────────────────────
  server.tool(
    "request_quote",
    "Generate a URL for the user to request a venue quote on Eventflare. Does not submit any data — returns a link the user can visit to complete their inquiry.",
    {
      city: z.string().describe("City slug"),
      event_type: z.string().optional().describe("Type of event"),
      capacity: z.number().optional().describe("Expected number of guests"),
      date: z.string().optional().describe("Preferred date (ISO format, e.g. 2026-06-15)"),
      venue_slug: z.string().optional().describe("Specific venue slug (if known)"),
    },
    async (params) => {
      logQuery({
        timestamp: new Date().toISOString(),
        tool: "request_quote",
        city: params.city,
        capacity: params.capacity,
        eventType: params.event_type,
      });

      // Build inquiry URL
      let inquiryUrl: string;

      if (params.venue_slug) {
        // Specific venue
        inquiryUrl = `${EVENTFLARE_URL}/spaces/${params.city}/${params.venue_slug}#inquiry`;
      } else {
        // City browse with filters
        const urlParams = new URLSearchParams();
        if (params.event_type) urlParams.set("type", params.event_type);
        if (params.capacity) urlParams.set("capacity", String(params.capacity));
        if (params.date) urlParams.set("date", params.date);
        const qs = urlParams.toString();
        inquiryUrl = `${EVENTFLARE_URL}/venues/${params.city}${qs ? `?${qs}` : ""}`;
      }

      const response = {
        inquiry_url: inquiryUrl,
        message:
          "Visit this link to browse venues and submit your inquiry on Eventflare. A local event expert will respond within 24 hours.",
        source: "Eventflare — eventflare.io",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
