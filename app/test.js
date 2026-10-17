import React from 'react';
import { renderToString } from 'react-dom/server';
import { Card } from '@shopify/polaris';

export default function Test() {
  console.log(renderToString(<Card><div>TEST</div></Card>));
  return null;
}
