// Copyright (c) 2022, Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { filter, lastValueFrom, map, race, Subject, take } from 'rxjs';
import { v4 as uuidV4 } from 'uuid';
import Browser from 'webextension-polyfill';

import { Window } from './Window';

import type { MoveCallTransaction } from '@mysten/sui.js';
import type { TransactionRequest } from '_payloads/transactions';
import type { TransactionRequestResponse } from '_payloads/transactions/ui/TransactionRequestResponse';
import type { ContentScriptConnection } from '_src/background/connections/ContentScriptConnection';

const TX_STORE_KEY = 'transactions';

function openTxWindow(txRequestID: string) {
    return new Window(
        Browser.runtime.getURL('ui.html') +
            `#/tx-approval/${encodeURIComponent(txRequestID)}`
    );
}

class Transactions {
    private _txResponseMessages = new Subject<TransactionRequestResponse>();

    public async executeTransaction(
        tx: MoveCallTransaction | undefined,
        txBytes: Uint8Array | undefined,
        connection: ContentScriptConnection
    ) {
        const txRequest = this.createTransactionRequest(
            tx,
            txBytes,
            connection.origin,
            connection.originFavIcon
        );
        await this.storeTransactionRequest(txRequest);
        const popUp = openTxWindow(txRequest.id);
        const popUpClose = (await popUp.show()).pipe(
            take(1),
            map<number, false>(() => false)
        );
        const txResponseMessage = this._txResponseMessages.pipe(
            filter((msg) => msg.txID === txRequest.id),
            take(1)
        );
        return lastValueFrom(
            race(popUpClose, txResponseMessage).pipe(
                take(1),
                map(async (response) => {
                    if (response) {
                        const { approved, txResult, tsResultError } = response;
                        if (approved) {
                            txRequest.approved = approved;
                            txRequest.txResult = txResult;
                            txRequest.txResultError = tsResultError;
                            await this.storeTransactionRequest(txRequest);
                            if (tsResultError) {
                                throw new Error(
                                    `Transaction failed with the following error. ${tsResultError}`
                                );
                            }
                            if (!txResult) {
                                throw new Error(`Transaction result is empty`);
                            }
                            return txResult;
                        }
                    }
                    await this.removeTransactionRequest(txRequest.id);
                    throw new Error('Transaction rejected from user');
                })
            )
        );
    }

    public async getTransactionRequests(): Promise<
        Record<string, TransactionRequest>
    > {
        return (await Browser.storage.local.get({ [TX_STORE_KEY]: {} }))[
            TX_STORE_KEY
        ];
    }

    public async getTransactionRequest(
        txRequestID: string
    ): Promise<TransactionRequest | null> {
        return (await this.getTransactionRequests())[txRequestID] || null;
    }

    public handleMessage(msg: TransactionRequestResponse) {
        this._txResponseMessages.next(msg);
    }

    private createTransactionRequest(
        tx: MoveCallTransaction | undefined,
        txBytes: Uint8Array | undefined,
        origin: string,
        originFavIcon?: string
    ): TransactionRequest {
        if (tx !== undefined) {
            return {
                id: uuidV4(),
                approved: null,
                origin,
                originFavIcon,
                createdDate: new Date().toISOString(),
                type: 'move-call',
                tx,
            };
        } else if (txBytes !== undefined) {
            return {
                id: uuidV4(),
                approved: null,
                origin,
                originFavIcon,
                createdDate: new Date().toISOString(),
                type: 'serialized-move-call',
                txBytes,
            };
        } else {
            throw new Error("Either tx or txBytes needs to be defined.");
        }
    }

    private async saveTransactionRequests(
        txRequests: Record<string, TransactionRequest>
    ) {
        await Browser.storage.local.set({ [TX_STORE_KEY]: txRequests });
    }

    private async storeTransactionRequest(txRequest: TransactionRequest) {
        const txs = await this.getTransactionRequests();
        txs[txRequest.id] = txRequest;
        await this.saveTransactionRequests(txs);
    }

    private async removeTransactionRequest(txID: string) {
        const txs = await this.getTransactionRequests();
        delete txs[txID];
        await this.saveTransactionRequests(txs);
    }
}

export default new Transactions();
