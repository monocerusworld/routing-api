import { CurrencyAmount, TradeType } from '@uniswap/sdk-core';
import { CacheMode } from '@tartz-one/smart-order-router';
/**
 * Models out the strategy for categorizing cached routes into buckets by amount traded
 */
export class CachedRoutesStrategy {
    /**
     * @param pair
     * @param tradeType
     * @param chainId
     * @param buckets
     */
    constructor({ pair, tradeType, chainId, buckets }) {
        this.pair = pair;
        this._tradeType = tradeType;
        this.chainId = chainId;
        // Used for deciding to show metrics in the dashboard related to Tapcompare
        this.willTapcompare = buckets.find((bucket) => bucket.cacheMode == CacheMode.Tapcompare) != undefined;
        // It is important that we sort the buckets in ascendant order for the algorithm to work correctly.
        // For a strange reason the `.sort()` function was comparing the number as strings, so I had to pass a compareFn.
        this.buckets = buckets.map((params) => params.bucket).sort((a, b) => a - b);
        // Create a Map<bucket, CachedRoutesBucket> for easy lookup once we find a bucket.
        this.bucketsMap = new Map(buckets.map((params) => [params.bucket, params]));
    }
    get tradeType() {
        return this._tradeType == TradeType.EXACT_INPUT ? 'ExactIn' : 'ExactOut';
    }
    readablePairTradeTypeChainId() {
        return `${this.pair.toUpperCase()}/${this.tradeType}/${this.chainId}`;
    }
    bucketPairs() {
        if (this.buckets.length > 0) {
            const firstBucket = [[0, this.buckets[0]]];
            const middleBuckets = this.buckets.length > 1
                ? this.buckets.slice(0, -1).map((bucket, i) => [bucket, this.buckets[i + 1]])
                : [];
            const lastBucket = [[this.buckets.slice(-1)[0], -1]];
            return firstBucket.concat(middleBuckets).concat(lastBucket);
        }
        else {
            return [];
        }
    }
    /**
     * Given an amount, we will search the bucket that has a cached route for that amount based on the CachedRoutesBucket array
     * @param amount
     */
    getCachingBucket(amount) {
        // Find the first bucket which is greater or equal than the amount.
        // If no bucket is found it means it's not supposed to be cached.
        // e.g. let buckets = [10, 50, 100, 500, 1000]
        // e.g.1. if amount = 0.10, then bucket = 10
        // e.g.2. if amount = 501, then bucket = 1000
        // e.g.3. If amount = 1001 then bucket = undefined
        const bucket = this.buckets.find((bucket) => {
            // Create a CurrencyAmount object to compare the amount with the bucket.
            const bucketCurrency = CurrencyAmount.fromRawAmount(amount.currency, bucket * 10 ** amount.currency.decimals);
            // Given that the array of buckets is sorted, we want to find the first bucket that makes the amount lessThanOrEqual to the bucket
            // refer to the examples above
            return amount.lessThan(bucketCurrency) || amount.equalTo(bucketCurrency);
        });
        if (bucket) {
            // if a bucket was found, return the CachedRoutesBucket associated to that bucket.
            return this.bucketsMap.get(bucket);
        }
        return undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLXJvdXRlcy1zdHJhdGVneS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL2xpYi9oYW5kbGVycy9yb3V0ZXItZW50aXRpZXMvcm91dGUtY2FjaGluZy9tb2RlbC9jYWNoZWQtcm91dGVzLXN0cmF0ZWd5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBWSxjQUFjLEVBQUUsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFFdkUsT0FBTyxFQUFFLFNBQVMsRUFBVyxNQUFNLCtCQUErQixDQUFBO0FBU2xFOztHQUVHO0FBQ0gsTUFBTSxPQUFPLG9CQUFvQjtJQVEvQjs7Ozs7T0FLRztJQUNILFlBQVksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQTRCO1FBQ3pFLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFBO1FBQ2hCLElBQUksQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO1FBQzNCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBRXRCLDJFQUEyRTtRQUMzRSxJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxJQUFJLFNBQVMsQ0FBQTtRQUVyRyxtR0FBbUc7UUFDbkcsaUhBQWlIO1FBQ2pILElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUUzRSxrRkFBa0Y7UUFDbEYsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQzdFLENBQUM7SUFFRCxJQUFXLFNBQVM7UUFDbEIsT0FBTyxJQUFJLENBQUMsVUFBVSxJQUFJLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFBO0lBQzFFLENBQUM7SUFFTSw0QkFBNEI7UUFDakMsT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDdkUsQ0FBQztJQUVNLFdBQVc7UUFDaEIsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7WUFDM0IsTUFBTSxXQUFXLEdBQXVCLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDOUQsTUFBTSxhQUFhLEdBQ2pCLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUM7Z0JBQ3JCLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFvQixFQUFFLENBQUMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFFLENBQUMsQ0FBQztnQkFDaEcsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtZQUNSLE1BQU0sVUFBVSxHQUF1QixDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFeEUsT0FBTyxXQUFXLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtTQUM1RDthQUFNO1lBQ0wsT0FBTyxFQUFFLENBQUE7U0FDVjtJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSSxnQkFBZ0IsQ0FBQyxNQUFnQztRQUN0RCxtRUFBbUU7UUFDbkUsaUVBQWlFO1FBQ2pFLDhDQUE4QztRQUM5Qyw0Q0FBNEM7UUFDNUMsNkNBQTZDO1FBQzdDLGtEQUFrRDtRQUNsRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQWMsRUFBRSxFQUFFO1lBQ2xELHdFQUF3RTtZQUN4RSxNQUFNLGNBQWMsR0FBRyxjQUFjLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRTdHLGtJQUFrSTtZQUNsSSw4QkFBOEI7WUFDOUIsT0FBTyxNQUFNLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDMUUsQ0FBQyxDQUFDLENBQUE7UUFFRixJQUFJLE1BQU0sRUFBRTtZQUNWLGtGQUFrRjtZQUNsRixPQUFPLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1NBQ25DO1FBRUQsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ3VycmVuY3ksIEN1cnJlbmN5QW1vdW50LCBUcmFkZVR5cGUgfSBmcm9tICdAdW5pc3dhcC9zZGstY29yZSdcbmltcG9ydCB7IENhY2hlZFJvdXRlc0J1Y2tldCB9IGZyb20gJy4vY2FjaGVkLXJvdXRlcy1idWNrZXQnXG5pbXBvcnQgeyBDYWNoZU1vZGUsIENoYWluSWQgfSBmcm9tICdAdGFydHotb25lL3NtYXJ0LW9yZGVyLXJvdXRlcidcblxuaW50ZXJmYWNlIENhY2hlZFJvdXRlc1N0cmF0ZWd5QXJncyB7XG4gIHBhaXI6IHN0cmluZ1xuICB0cmFkZVR5cGU6IFRyYWRlVHlwZVxuICBjaGFpbklkOiBDaGFpbklkXG4gIGJ1Y2tldHM6IENhY2hlZFJvdXRlc0J1Y2tldFtdXG59XG5cbi8qKlxuICogTW9kZWxzIG91dCB0aGUgc3RyYXRlZ3kgZm9yIGNhdGVnb3JpemluZyBjYWNoZWQgcm91dGVzIGludG8gYnVja2V0cyBieSBhbW91bnQgdHJhZGVkXG4gKi9cbmV4cG9ydCBjbGFzcyBDYWNoZWRSb3V0ZXNTdHJhdGVneSB7XG4gIHJlYWRvbmx5IHBhaXI6IHN0cmluZ1xuICByZWFkb25seSBfdHJhZGVUeXBlOiBUcmFkZVR5cGVcbiAgcmVhZG9ubHkgY2hhaW5JZDogQ2hhaW5JZFxuICByZWFkb25seSB3aWxsVGFwY29tcGFyZTogYm9vbGVhblxuICBwcml2YXRlIGJ1Y2tldHM6IG51bWJlcltdXG4gIHByaXZhdGUgYnVja2V0c01hcDogTWFwPG51bWJlciwgQ2FjaGVkUm91dGVzQnVja2V0PlxuXG4gIC8qKlxuICAgKiBAcGFyYW0gcGFpclxuICAgKiBAcGFyYW0gdHJhZGVUeXBlXG4gICAqIEBwYXJhbSBjaGFpbklkXG4gICAqIEBwYXJhbSBidWNrZXRzXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7IHBhaXIsIHRyYWRlVHlwZSwgY2hhaW5JZCwgYnVja2V0cyB9OiBDYWNoZWRSb3V0ZXNTdHJhdGVneUFyZ3MpIHtcbiAgICB0aGlzLnBhaXIgPSBwYWlyXG4gICAgdGhpcy5fdHJhZGVUeXBlID0gdHJhZGVUeXBlXG4gICAgdGhpcy5jaGFpbklkID0gY2hhaW5JZFxuXG4gICAgLy8gVXNlZCBmb3IgZGVjaWRpbmcgdG8gc2hvdyBtZXRyaWNzIGluIHRoZSBkYXNoYm9hcmQgcmVsYXRlZCB0byBUYXBjb21wYXJlXG4gICAgdGhpcy53aWxsVGFwY29tcGFyZSA9IGJ1Y2tldHMuZmluZCgoYnVja2V0KSA9PiBidWNrZXQuY2FjaGVNb2RlID09IENhY2hlTW9kZS5UYXBjb21wYXJlKSAhPSB1bmRlZmluZWRcblxuICAgIC8vIEl0IGlzIGltcG9ydGFudCB0aGF0IHdlIHNvcnQgdGhlIGJ1Y2tldHMgaW4gYXNjZW5kYW50IG9yZGVyIGZvciB0aGUgYWxnb3JpdGhtIHRvIHdvcmsgY29ycmVjdGx5LlxuICAgIC8vIEZvciBhIHN0cmFuZ2UgcmVhc29uIHRoZSBgLnNvcnQoKWAgZnVuY3Rpb24gd2FzIGNvbXBhcmluZyB0aGUgbnVtYmVyIGFzIHN0cmluZ3MsIHNvIEkgaGFkIHRvIHBhc3MgYSBjb21wYXJlRm4uXG4gICAgdGhpcy5idWNrZXRzID0gYnVja2V0cy5tYXAoKHBhcmFtcykgPT4gcGFyYW1zLmJ1Y2tldCkuc29ydCgoYSwgYikgPT4gYSAtIGIpXG5cbiAgICAvLyBDcmVhdGUgYSBNYXA8YnVja2V0LCBDYWNoZWRSb3V0ZXNCdWNrZXQ+IGZvciBlYXN5IGxvb2t1cCBvbmNlIHdlIGZpbmQgYSBidWNrZXQuXG4gICAgdGhpcy5idWNrZXRzTWFwID0gbmV3IE1hcChidWNrZXRzLm1hcCgocGFyYW1zKSA9PiBbcGFyYW1zLmJ1Y2tldCwgcGFyYW1zXSkpXG4gIH1cblxuICBwdWJsaWMgZ2V0IHRyYWRlVHlwZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLl90cmFkZVR5cGUgPT0gVHJhZGVUeXBlLkVYQUNUX0lOUFVUID8gJ0V4YWN0SW4nIDogJ0V4YWN0T3V0J1xuICB9XG5cbiAgcHVibGljIHJlYWRhYmxlUGFpclRyYWRlVHlwZUNoYWluSWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5wYWlyLnRvVXBwZXJDYXNlKCl9LyR7dGhpcy50cmFkZVR5cGV9LyR7dGhpcy5jaGFpbklkfWBcbiAgfVxuXG4gIHB1YmxpYyBidWNrZXRQYWlycygpOiBbbnVtYmVyLCBudW1iZXJdW10ge1xuICAgIGlmICh0aGlzLmJ1Y2tldHMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZmlyc3RCdWNrZXQ6IFtudW1iZXIsIG51bWJlcl1bXSA9IFtbMCwgdGhpcy5idWNrZXRzWzBdXV1cbiAgICAgIGNvbnN0IG1pZGRsZUJ1Y2tldHM6IFtudW1iZXIsIG51bWJlcl1bXSA9XG4gICAgICAgIHRoaXMuYnVja2V0cy5sZW5ndGggPiAxXG4gICAgICAgICAgPyB0aGlzLmJ1Y2tldHMuc2xpY2UoMCwgLTEpLm1hcCgoYnVja2V0LCBpKTogW251bWJlciwgbnVtYmVyXSA9PiBbYnVja2V0LCB0aGlzLmJ1Y2tldHNbaSArIDFdIV0pXG4gICAgICAgICAgOiBbXVxuICAgICAgY29uc3QgbGFzdEJ1Y2tldDogW251bWJlciwgbnVtYmVyXVtdID0gW1t0aGlzLmJ1Y2tldHMuc2xpY2UoLTEpWzBdLCAtMV1dXG5cbiAgICAgIHJldHVybiBmaXJzdEJ1Y2tldC5jb25jYXQobWlkZGxlQnVja2V0cykuY29uY2F0KGxhc3RCdWNrZXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlbiBhbiBhbW91bnQsIHdlIHdpbGwgc2VhcmNoIHRoZSBidWNrZXQgdGhhdCBoYXMgYSBjYWNoZWQgcm91dGUgZm9yIHRoYXQgYW1vdW50IGJhc2VkIG9uIHRoZSBDYWNoZWRSb3V0ZXNCdWNrZXQgYXJyYXlcbiAgICogQHBhcmFtIGFtb3VudFxuICAgKi9cbiAgcHVibGljIGdldENhY2hpbmdCdWNrZXQoYW1vdW50OiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT4pOiBDYWNoZWRSb3V0ZXNCdWNrZXQgfCB1bmRlZmluZWQge1xuICAgIC8vIEZpbmQgdGhlIGZpcnN0IGJ1Y2tldCB3aGljaCBpcyBncmVhdGVyIG9yIGVxdWFsIHRoYW4gdGhlIGFtb3VudC5cbiAgICAvLyBJZiBubyBidWNrZXQgaXMgZm91bmQgaXQgbWVhbnMgaXQncyBub3Qgc3VwcG9zZWQgdG8gYmUgY2FjaGVkLlxuICAgIC8vIGUuZy4gbGV0IGJ1Y2tldHMgPSBbMTAsIDUwLCAxMDAsIDUwMCwgMTAwMF1cbiAgICAvLyBlLmcuMS4gaWYgYW1vdW50ID0gMC4xMCwgdGhlbiBidWNrZXQgPSAxMFxuICAgIC8vIGUuZy4yLiBpZiBhbW91bnQgPSA1MDEsIHRoZW4gYnVja2V0ID0gMTAwMFxuICAgIC8vIGUuZy4zLiBJZiBhbW91bnQgPSAxMDAxIHRoZW4gYnVja2V0ID0gdW5kZWZpbmVkXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5idWNrZXRzLmZpbmQoKGJ1Y2tldDogbnVtYmVyKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgYSBDdXJyZW5jeUFtb3VudCBvYmplY3QgdG8gY29tcGFyZSB0aGUgYW1vdW50IHdpdGggdGhlIGJ1Y2tldC5cbiAgICAgIGNvbnN0IGJ1Y2tldEN1cnJlbmN5ID0gQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChhbW91bnQuY3VycmVuY3ksIGJ1Y2tldCAqIDEwICoqIGFtb3VudC5jdXJyZW5jeS5kZWNpbWFscylcblxuICAgICAgLy8gR2l2ZW4gdGhhdCB0aGUgYXJyYXkgb2YgYnVja2V0cyBpcyBzb3J0ZWQsIHdlIHdhbnQgdG8gZmluZCB0aGUgZmlyc3QgYnVja2V0IHRoYXQgbWFrZXMgdGhlIGFtb3VudCBsZXNzVGhhbk9yRXF1YWwgdG8gdGhlIGJ1Y2tldFxuICAgICAgLy8gcmVmZXIgdG8gdGhlIGV4YW1wbGVzIGFib3ZlXG4gICAgICByZXR1cm4gYW1vdW50Lmxlc3NUaGFuKGJ1Y2tldEN1cnJlbmN5KSB8fCBhbW91bnQuZXF1YWxUbyhidWNrZXRDdXJyZW5jeSlcbiAgICB9KVxuXG4gICAgaWYgKGJ1Y2tldCkge1xuICAgICAgLy8gaWYgYSBidWNrZXQgd2FzIGZvdW5kLCByZXR1cm4gdGhlIENhY2hlZFJvdXRlc0J1Y2tldCBhc3NvY2lhdGVkIHRvIHRoYXQgYnVja2V0LlxuICAgICAgcmV0dXJuIHRoaXMuYnVja2V0c01hcC5nZXQoYnVja2V0KVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxufVxuIl19