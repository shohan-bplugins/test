import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Boxes, FileText, LayoutDashboard, Sparkles } from "lucide-react";

import { authenticate } from "../shopify.server";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="text-center space-y-3 py-10">
          <div className="inline-flex items-center justify-center size-16 border bg-card">
            <LayoutDashboard className="size-7 text-muted-foreground" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Dashboard Coming Soon
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We&rsquo;re building an overview of your store&rsquo;s 3D
            experience here. In the meantime, head to one of the sections
            below to get started.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4" /> Product 3D Models
              </CardTitle>
              <CardDescription>
                Attach 3D models to individual products and manage per-product
                viewer settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link to="/app/products">Open</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Boxes className="size-4" /> 3D Model Library
              </CardTitle>
              <CardDescription>
                Manage standalone 3D models you embed via the page block.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link to="/app/models">Open</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="size-4" /> Documentation
              </CardTitle>
              <CardDescription>
                Setup steps, viewer options, and troubleshooting tips.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link to="/app/documentation">Open</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
